import { NotFoundError } from "../../shared-kernel/DomainError.js";
import type { AuthSessionId, LearnerId, TutorSpaceId } from "../../shared-kernel/ids.js";
import { mfaEnrolled, type Account, type AdultAccount } from "../domain/Account.js";
import { isActive } from "../domain/Guardianship.js";
import { EmailAddress, SpaceCode, Username } from "../domain/values.js";
import type { Actor } from "./Actor.js";
import { InvalidCredentialsError, InvalidTotpError, TooManyAttemptsError } from "./errors.js";
import type { AuthSession, IdentityStore } from "./ports.js";
import { ABSOLUTE_LIFETIME_MS, isSessionAlive } from "./sessionRules.js";
import { auditEntry, type IdentityDependencies } from "./support.js";

export interface ClientContext {
  /**
   * Clé de limitation de l'adresse (IPv4 entière, préfixe /64 en IPv6), en mémoire seulement (R8,
   * verdict L1 R-5). Jamais stockée ni journalisée.
   */
  readonly ipKey: string;
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

/** Au 10e code TOTP faux cumulé sur un compte : alerte au titulaire, audit, sessions en attente révoquées (R-1). */
export const MFA_ALERT_THRESHOLD = 10;

/** Compteur d'échecs TOTP d'un compte : seul un bon code le remet à zéro, jamais le mot de passe (R-1). */
const mfaAccountKey = (accountId: string): string => `mfa-account:${accountId}`;

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
/** Événement d'intégration : une alerte de sécurité doit être envoyée au titulaire d'un compte. */
export const ALERT_REQUESTED = "identity.alert-requested";

export class AuthService {
  constructor(private readonly deps: IdentityDependencies) {}

  async loginAdult(input: { email: string; password: string }, client: ClientContext): Promise<LoginResult> {
    const keys = [`adult:${input.email.trim().toLowerCase()}`, `ip:${client.ipKey}`];
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
      `ip:${client.ipKey}`,
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

  /**
   * Seconde étape de la connexion : code TOTP ou code de secours (R7).
   *
   * Les échecs sont comptés PAR COMPTE (`mfa-account:…`) et par IP. Une connexion réussie par mot
   * de passe ne remet pas ce compteur à zéro : seul un bon code le fait. Sans cela, qui connaît le
   * mot de passe pourrait enchaîner « mot de passe → 5 codes » sans fin (verdict L1, R-1, M8).
   * Au 10e échec : blocage de 15 min, sessions en attente révoquées, e-mail au titulaire, audit.
   */
  async verifyMfa(sessionToken: string, code: string, client: Pick<ClientContext, "ipKey">): Promise<void> {
    const now = this.deps.clock.now();
    const resolved = await this.#load(sessionToken, now);
    if (resolved === null || !resolved.session.mfaPending) throw new InvalidCredentialsError();
    const { session } = resolved;
    const accountKey = mfaAccountKey(session.accountId);
    const keys = [accountKey, `ip:${client.ipKey}`];
    this.#throttle(keys);

    const outcome = await this.deps.gateway.inSpace(session.tutorSpaceId, async (store) => {
      const account = await store.accountById(session.accountId);
      if (account === null || account.role === "learner" || account.mfa.status !== "enabled") return null;
      const step = this.deps.totp.verify(account.mfa.secretCiphertext, code, now, account.mfa.lastUsedStep);
      // Le pas est consommé atomiquement : deux requêtes simultanées avec le même code, une seule passe (R-4).
      const viaTotp = step !== null && (await store.useTotpStep(account.id, step));
      const viaRecovery =
        !viaTotp &&
        (await store.useRecoveryCode(account.id, this.deps.tokens.hash(normalizeRecovery(code)), now));
      if (account.role === "tutor") {
        await store.audit(
          auditEntry(
            this.deps,
            session.tutorSpaceId,
            { kind: "tutor", id: account.id },
            "identity.tutor-login",
            viaTotp || viaRecovery ? "success" : "failed",
            {
              reasonCode: viaTotp ? "totp" : viaRecovery ? "recovery-code" : "invalid-totp",
            },
          ),
        );
      }
      if (!viaTotp && !viaRecovery) return { ok: false as const, account };
      await store.updateSession({ ...session, mfaPending: false, authenticatedAt: now, lastSeenAt: now });
      return { ok: true as const, account };
    });

    if (outcome === null || !outcome.ok) {
      this.deps.throttle.recordFailure(keys, now);
      const failures = this.deps.throttle.failureCount(accountKey, now);
      if (outcome !== null && failures > 0 && failures % MFA_ALERT_THRESHOLD === 0)
        await this.#raiseMfaAlarm(outcome.account, now);
      throw new InvalidTotpError();
    }
    this.deps.throttle.recordSuccess([accountKey]);
    const { account } = outcome;
    if (account.role === "tutor") {
      // Contrôle de détection, envoyé de façon DURABLE par l'outbox (verdict L1 R-2, verdict L5 §6).
      await this.#requestAlert(account, "tutor-login-alert", now, session.userAgent);
    }
  }

  /** Trop de codes faux après le bon mot de passe : le mot de passe est sans doute connu d'un tiers (M8). */
  async #raiseMfaAlarm(account: AdultAccount, now: Date): Promise<void> {
    await this.deps.gateway.inSpace(account.tutorSpaceId, async (store) => {
      await store.revokePendingSessionsOf(account.id, now);
      await store.audit(
        auditEntry(
          this.deps,
          account.tutorSpaceId,
          { kind: account.role, id: account.id },
          "identity.mfa-failed",
          "denied",
          {
            reasonCode: "too-many-invalid-codes",
          },
        ),
      );
    });
    await this.#requestAlert(account, "mfa-failures-alert", now, null);
  }

  /**
   * Alerte au titulaire du compte, écrite dans l'outbox : le relais l'envoie, la réessaie en cas de
   * panne du fournisseur, et l'abandonne (trace en file d'échec) au-delà du plafond. L'événement ne porte
   * que l'identifiant du compte, jamais l'adresse e-mail (minimisation).
   */
  async #requestAlert(
    account: { readonly id: string; readonly tutorSpaceId: TutorSpaceId },
    template: "tutor-login-alert" | "mfa-failures-alert",
    at: Date,
    userAgent: string | null,
  ): Promise<void> {
    await this.deps.gateway.inSpace(account.tutorSpaceId, (store) =>
      store.publish({
        id: this.deps.ids.next("EventId"),
        type: ALERT_REQUESTED,
        tutorSpaceId: account.tutorSpaceId,
        occurredAt: at,
        payload: { template, accountId: account.id, at: at.toISOString(), userAgent },
      }),
    );
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
    // Le compteur TOTP du compte s'applique aussi ici : la réauthentification ne doit pas devenir
    // un second guichet pour essayer des codes (R7, R-1).
    const keys = [`reauth:${actor.id}`, mfaAccountKey(actor.id)];
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
        if (step === null || !(await store.useTotpStep(account.id, step))) return false;
      }
      await store.updateSession({ ...session, authenticatedAt: now, lastSeenAt: now });
      return true;
    });
    if (!ok) {
      this.deps.throttle.recordFailure(keys, now);
      throw new InvalidCredentialsError();
    }
    this.deps.throttle.recordSuccess([`reauth:${actor.id}`]);
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

  #conclude(keys: readonly string[], outcome: Verified): LoginResult {
    if (!outcome.ok) {
      this.deps.throttle.recordFailure(keys, this.deps.clock.now());
      throw new InvalidCredentialsError();
    }
    this.deps.throttle.recordSuccess(keys.filter((key) => !key.startsWith("ip:")));
    const alerted = outcome.alert;
    if (alerted !== null && alerted.role === "tutor") {
      // Écrite dans l'outbox après la réponse : la connexion n'attend pas l'alerte.
      this.deps.background.run("identity.login-alert-failed", () =>
        this.#requestAlert(alerted, "tutor-login-alert", this.deps.clock.now(), null),
      );
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
