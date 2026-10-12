import { NotFoundError } from "../../shared-kernel/DomainError.js";
import type { AuthSessionId, LearnerId, TutorSpaceId } from "../../shared-kernel/ids.js";
import { mfaEnrolled, type Account } from "../domain/Account.js";
import { isActive } from "../domain/Guardianship.js";
import { EmailAddress, SpaceCode, Username } from "../domain/values.js";
import type { Actor } from "./Actor.js";
import { InvalidCredentialsError, InvalidTotpError, TooManyAttemptsError } from "./errors.js";
import type { AuthSession, IdentityStore } from "./ports.js";
import { ABSOLUTE_LIFETIME_MS, isSessionAlive } from "./sessionRules.js";
import { auditEntry, type IdentityDependencies } from "./support.js";

export interface ClientContext {
  /** Adresse complète, en mémoire seulement : limitation de débit (R8). Jamais stockée ni journalisée. */
  readonly ip: string;
  /** Adresse tronquée (/24, /48) : seule forme stockée, avec la session. */
  readonly ipPrefix: string | null;
  readonly userAgent: string | null;
}

export interface LoginResult {
  readonly sessionToken: string;
  /** Mot de passe correct ; code TOTP attendu avant tout accès. */
  readonly mfaPending: boolean;
  /** Tuteur sans TOTP : il doit l'activer avant toute action métier (R7). */
  readonly mfaEnrollmentRequired: boolean;
}

export interface ResolvedSession {
  readonly actor: Actor;
  readonly session: AuthSession;
}

/** Une session n'est « touchée » en base qu'une fois par minute : moins d'écritures. */
const TOUCH_INTERVAL_MS = 60 * 1000;

type Verified =
  | { readonly ok: true; readonly result: LoginResult; readonly alert: Account | null }
  | { readonly ok: false };

/**
 * Connexion, sessions et double authentification (R7, R8, ADR-0006).
 * Toute cause d'échec produit la même erreur, avec le même coût de calcul (argon2 contre un hash
 * factice quand le compte n'existe pas) ; les essais sont comptés par identifiant et par IP.
 */
export class AuthService {
  constructor(private readonly deps: IdentityDependencies) {}

  async loginAdult(input: { email: string; password: string }, client: ClientContext): Promise<LoginResult> {
    const keys = [`adult:${input.email.trim().toLowerCase()}`, `ip:${client.ip}`];
    this.#throttle(keys);
    // Une adresse mal formée est un échec ordinaire : même réponse, même coût.
    const email = parsedOrNull(() => EmailAddress(input.email));
    const found = email === null ? null : await this.deps.gateway.adultByEmail(email);
    if (found === null) return this.#fail(keys, input.password);
    const outcome = await this.deps.gateway.inSpace(found.tutorSpaceId, (store) =>
      this.#verifyAndOpen(store, found.tutorSpaceId, found.accountId, input.password, client),
    );
    return this.#conclude(keys, outcome);
  }

  async loginLearner(
    input: { spaceCode: string; username: string; password: string },
    client: ClientContext,
  ): Promise<LoginResult> {
    const keys = [
      `learner:${input.spaceCode.trim().toLowerCase()}:${input.username.trim().toLowerCase()}`,
      `ip:${client.ip}`,
    ];
    this.#throttle(keys);
    const parsed = parsedOrNull(() => ({
      code: SpaceCode(input.spaceCode),
      username: Username(input.username),
    }));
    const spaceId = parsed === null ? null : await this.deps.gateway.spaceByCode(parsed.code);
    if (parsed === null || spaceId === null) return this.#fail(keys, input.password);
    const username = parsed.username;
    const outcome = await this.deps.gateway.inSpace(spaceId, async (store) => {
      const learner = await store.learnerByUsername(username);
      if (learner === null) {
        await this.deps.hasher.verifyAgainstDummy(input.password);
        return { ok: false } as const;
      }
      return this.#verifyAndOpen(store, spaceId, learner.id, input.password, client);
    });
    return this.#conclude(keys, outcome);
  }

  /** Seconde étape de la connexion : code TOTP ou code de secours (R7). */
  async verifyMfa(sessionToken: string, code: string): Promise<void> {
    const now = this.deps.clock.now();
    const resolved = await this.#load(sessionToken, now);
    if (resolved === null || !resolved.session.mfaPending) throw new InvalidCredentialsError();
    const { session } = resolved;
    const keys = [`mfa:${session.id}`];
    this.#throttle(keys);
    const result = await this.deps.gateway.inSpace(session.tutorSpaceId, async (store) => {
      const account = await store.accountById(session.accountId);
      if (account === null || account.role === "learner" || account.mfa.status !== "enabled") return null;
      const step = this.deps.totp.verify(account.mfa.secretCiphertext, code, now, account.mfa.lastUsedStep);
      const viaRecovery =
        step === null &&
        (await store.useRecoveryCode(account.id, this.deps.tokens.hash(normalizeRecovery(code)), now));
      if (step === null && !viaRecovery) return null;
      if (step !== null)
        await store.updateAccount({ ...account, mfa: { ...account.mfa, lastUsedStep: step } });
      await store.updateSession({ ...session, mfaPending: false, authenticatedAt: now, lastSeenAt: now });
      if (account.role === "tutor") {
        await store.audit(
          auditEntry(
            this.deps,
            session.tutorSpaceId,
            { kind: "tutor", id: account.id },
            "identity.tutor-login",
            "success",
            {
              reasonCode: viaRecovery ? "recovery-code" : "totp",
            },
          ),
        );
      }
      return account;
    });
    if (result === null) {
      this.deps.throttle.recordFailure(keys, now);
      if (!this.deps.throttle.check(keys, now).allowed) await this.logout(sessionToken);
      throw new InvalidTotpError();
    }
    this.deps.throttle.recordSuccess(keys);
    if (result.role === "tutor") {
      await this.deps.mailer.send({
        template: "tutor-login-alert",
        to: result.email,
        at: now,
        userAgent: session.userAgent,
      });
    }
  }

  /**
   * Résout le cookie en acteur, à chaque requête. Session absente, révoquée, expirée ou compte
   * désactivé : null, donc 401 (R8, R18).
   */
  async resolve(sessionToken: string): Promise<ResolvedSession | null> {
    return this.#load(sessionToken, this.deps.clock.now());
  }

  async logout(sessionToken: string): Promise<void> {
    const found = await this.deps.gateway.sessionByTokenHash(this.deps.tokens.hash(sessionToken));
    if (found === null) return;
    const now = this.deps.clock.now();
    await this.deps.gateway.inSpace(found.tutorSpaceId, async (store) => {
      const session = await store.sessionById(found.sessionId);
      if (session !== null && session.revokedAt === null)
        await store.updateSession({ ...session, revokedAt: now });
    });
  }

  /** Sessions actives de l'acteur, sans aucune empreinte de jeton. */
  async listSessions(actor: Actor): Promise<Array<Omit<AuthSession, "tokenHash">>> {
    const now = this.deps.clock.now();
    return this.deps.gateway.inSpace(actor.tutorSpaceId, async (store) => {
      const sessions = await store.sessionsOf(actor.id);
      // L'empreinte du jeton ne quitte jamais le module.
      return sessions
        .filter((session) => isSessionAlive(session, actor.kind, now))
        .map((session) => ({
          id: session.id,
          tutorSpaceId: session.tutorSpaceId,
          accountId: session.accountId,
          createdAt: session.createdAt,
          lastSeenAt: session.lastSeenAt,
          expiresAt: session.expiresAt,
          authenticatedAt: session.authenticatedAt,
          mfaPending: session.mfaPending,
          ipPrefix: session.ipPrefix,
          userAgent: session.userAgent,
          revokedAt: session.revokedAt,
        }));
    });
  }

  /** Révoque une de ses propres sessions ; celle d'un autre compte est introuvable (R2). */
  async revokeSession(actor: Actor, sessionId: AuthSessionId): Promise<void> {
    const now = this.deps.clock.now();
    const done = await this.deps.gateway.inSpace(actor.tutorSpaceId, async (store) => {
      const session = await store.sessionById(sessionId);
      if (session === null || session.accountId !== actor.id) return false;
      if (session.revokedAt === null) await store.updateSession({ ...session, revokedAt: now });
      return true;
    });
    if (!done) throw new NotFoundError();
  }

  /** Réauthentification avant une action sensible (R7) : mot de passe, et TOTP s'il est activé. */
  async reauthenticate(actor: Actor, input: { password: string; totpCode?: string }): Promise<void> {
    const now = this.deps.clock.now();
    const keys = [`reauth:${actor.id}`];
    this.#throttle(keys);
    const ok = await this.deps.gateway.inSpace(actor.tutorSpaceId, async (store) => {
      const account = await store.accountById(actor.id);
      const session = await store.sessionById(actor.sessionId);
      if (account === null || session === null) return false;
      if (!(await this.deps.hasher.verify(account.passwordHash, input.password))) return false;
      if (account.role !== "learner" && account.mfa.status === "enabled") {
        const step =
          input.totpCode === undefined
            ? null
            : this.deps.totp.verify(
                account.mfa.secretCiphertext,
                input.totpCode,
                now,
                account.mfa.lastUsedStep,
              );
        if (step === null) return false;
        await store.updateAccount({ ...account, mfa: { ...account.mfa, lastUsedStep: step } });
      }
      await store.updateSession({ ...session, authenticatedAt: now, lastSeenAt: now });
      return true;
    });
    if (!ok) {
      this.deps.throttle.recordFailure(keys, now);
      throw new InvalidCredentialsError();
    }
    this.deps.throttle.recordSuccess(keys);
  }

  #throttle(keys: readonly string[]): void {
    const decision = this.deps.throttle.check(keys, this.deps.clock.now());
    if (!decision.allowed) throw new TooManyAttemptsError(decision.retryAfterSeconds);
  }

  async #fail(keys: readonly string[], password: string): Promise<never> {
    await this.deps.hasher.verifyAgainstDummy(password);
    this.deps.throttle.recordFailure(keys, this.deps.clock.now());
    throw new InvalidCredentialsError();
  }

  async #conclude(keys: readonly string[], outcome: Verified): Promise<LoginResult> {
    if (!outcome.ok) {
      this.deps.throttle.recordFailure(keys, this.deps.clock.now());
      throw new InvalidCredentialsError();
    }
    this.deps.throttle.recordSuccess(keys.filter((key) => !key.startsWith("ip:")));
    if (outcome.alert !== null && outcome.alert.role === "tutor") {
      await this.deps.mailer.send({
        template: "tutor-login-alert",
        to: outcome.alert.email,
        at: this.deps.clock.now(),
        userAgent: null,
      });
    }
    return outcome.result;
  }

  async #verifyAndOpen(
    store: IdentityStore,
    tutorSpaceId: TutorSpaceId,
    accountId: string,
    password: string,
    client: ClientContext,
  ): Promise<Verified> {
    const account = await store.accountById(accountId);
    if (account === null) {
      await this.deps.hasher.verifyAgainstDummy(password);
      return { ok: false };
    }
    // Le hash est vérifié même pour un compte désactivé : même durée, même réponse (R8).
    const valid = await this.deps.hasher.verify(account.passwordHash, password);
    if (account.role === "tutor") {
      await store.audit(
        auditEntry(
          this.deps,
          tutorSpaceId,
          { kind: "tutor", id: account.id },
          "identity.tutor-login",
          valid ? "success" : "failed",
          {
            reasonCode: valid ? "password" : "invalid-credentials",
          },
        ),
      );
    }
    if (!valid || account.status !== "active") return { ok: false };

    const now = this.deps.clock.now();
    const mfaPending = account.role !== "learner" && account.mfa.status === "enabled";
    const { token, hash } = this.deps.tokens.generate();
    await store.insertSession({
      id: this.deps.ids.next("AuthSessionId"),
      tutorSpaceId,
      accountId: account.id,
      tokenHash: hash,
      createdAt: now,
      lastSeenAt: now,
      expiresAt: new Date(now.getTime() + ABSOLUTE_LIFETIME_MS),
      authenticatedAt: now,
      mfaPending,
      ipPrefix: client.ipPrefix,
      userAgent: client.userAgent,
      revokedAt: null,
    });
    return {
      ok: true,
      result: {
        sessionToken: token,
        mfaPending,
        mfaEnrollmentRequired: account.role === "tutor" && !mfaEnrolled(account),
      },
      // Le tuteur sans TOTP reçoit l'alerte dès le mot de passe ; avec TOTP, après le code (M8).
      alert: account.role === "tutor" && !mfaPending ? account : null,
    };
  }

  async #load(sessionToken: string, now: Date): Promise<ResolvedSession | null> {
    if (!/^[A-Za-z0-9_-]{43}$/.test(sessionToken)) return null;
    const found = await this.deps.gateway.sessionByTokenHash(this.deps.tokens.hash(sessionToken));
    if (found === null) return null;
    return this.deps.gateway.inSpace(found.tutorSpaceId, async (store) => {
      const session = await store.sessionById(found.sessionId);
      if (session === null) return null;
      const account = await store.accountById(session.accountId);
      if (account === null || account.status !== "active" || !isSessionAlive(session, account.role, now))
        return null;
      const touched =
        now.getTime() - session.lastSeenAt.getTime() >= TOUCH_INTERVAL_MS
          ? { ...session, lastSeenAt: now }
          : session;
      if (touched !== session) await store.updateSession(touched);
      return { session: touched, actor: await actorFor(store, account, touched) };
    });
  }
}

/** Valeur analysée, ou null si l'entrée est invalide (les erreurs d'analyse ne sortent pas d'ici). */
function parsedOrNull<T>(parse: () => T): T | null {
  try {
    return parse();
  } catch {
    return null;
  }
}

/** Les codes de secours s'affichent groupés (« abcd-efgh-… ») ; on compare sans tirets ni casse. */
export function normalizeRecovery(code: string): string {
  return code.replace(/[\s-]/g, "").toLowerCase();
}

async function actorFor(store: IdentityStore, account: Account, session: AuthSession): Promise<Actor> {
  const base = {
    tutorSpaceId: account.tutorSpaceId,
    sessionId: session.id,
    authenticatedAt: session.authenticatedAt,
  };
  switch (account.role) {
    case "tutor":
      return { ...base, kind: "tutor", id: account.id, mfaEnrolled: mfaEnrolled(account) };
    case "guardian": {
      const links = await store.guardianshipsOfGuardian(account.id);
      return {
        ...base,
        kind: "guardian",
        id: account.id,
        mfaEnrolled: mfaEnrolled(account),
        learnerIds: new Set<LearnerId>(links.filter(isActive).map((link) => link.learnerId)),
      };
    }
    case "learner":
      return { ...base, kind: "learner", id: account.id };
  }
}
