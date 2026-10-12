import { DomainError } from "../../shared-kernel/DomainError.js";
import type { Actor } from "./Actor.js";
import { InvalidTotpError } from "./errors.js";
import {
  auditActorOf,
  auditEntry,
  requireRecentAuthentication,
  type IdentityDependencies,
} from "./support.js";

class MfaNotAvailableError extends DomainError {
  readonly code = "identity.mfa-unavailable";

  constructor() {
    super("La double authentification concerne les comptes adultes déjà sans TOTP actif.");
  }
}

/** Nombre de codes de secours remis à l'activation ; chacun ne sert qu'une fois. */
export const RECOVERY_CODE_COUNT = 10;

/**
 * Enrôlement TOTP (RFC 6238) : obligatoire pour le tuteur, facultatif pour un parent (R7).
 * Le secret est stocké chiffré (AES-256-GCM) ; les codes de secours, hachés.
 */
export class MfaService {
  constructor(private readonly deps: IdentityDependencies) {}

  /** Étape 1 : nouveau secret, affiché une seule fois sous forme de QR code et de texte. */
  async startEnrollment(actor: Actor): Promise<{ otpauthUri: string; secret: string }> {
    return this.deps.gateway.inSpace(actor.tutorSpaceId, async (store) => {
      const account = await store.accountById(actor.id);
      if (account === null || account.role === "learner" || account.mfa.status === "enabled")
        throw new MfaNotAvailableError();
      const fresh = this.deps.totp.newSecret(account.email);
      await store.updateAccount({
        ...account,
        mfa: { status: "pending", secretCiphertext: fresh.ciphertext },
      });
      return { otpauthUri: fresh.otpauthUri, secret: fresh.secret };
    });
  }

  /** Étape 2 : un code juste prouve que l'application d'authentification est configurée. */
  async activate(actor: Actor, code: string): Promise<{ recoveryCodes: string[] }> {
    const now = this.deps.clock.now();
    const codes = Array.from({ length: RECOVERY_CODE_COUNT }, () => this.deps.tokens.recoveryCode());
    const result = await this.deps.gateway.inSpace(actor.tutorSpaceId, async (store) => {
      const account = await store.accountById(actor.id);
      if (account === null || account.role === "learner" || account.mfa.status !== "pending")
        throw new MfaNotAvailableError();
      const step = this.deps.totp.verify(account.mfa.secretCiphertext, code, now, null);
      if (step === null) return false;
      await store.updateAccount({
        ...account,
        mfa: { status: "enabled", secretCiphertext: account.mfa.secretCiphertext, lastUsedStep: step },
      });
      await store.replaceRecoveryCodes(
        account.id,
        codes.map((recovery) => this.deps.tokens.hash(recovery)),
        codes.map(() => this.deps.ids.next("RecoveryCodeId")),
      );
      const session = await store.sessionById(actor.sessionId);
      if (session !== null) await store.updateSession({ ...session, authenticatedAt: now });
      await store.audit(
        auditEntry(this.deps, actor.tutorSpaceId, auditActorOf(actor), "identity.mfa-enabled", "success"),
      );
      return true;
    });
    if (!result) throw new InvalidTotpError();
    return { recoveryCodes: codes.map((recovery) => recovery.replace(/(.{4})(?=.)/g, "$1-")) };
  }

  /** Nouveaux codes de secours : action sensible, réauthentification exigée (R7). */
  async regenerateRecoveryCodes(actor: Actor): Promise<{ recoveryCodes: string[] }> {
    requireRecentAuthentication(actor, this.deps.clock.now());
    const codes = Array.from({ length: RECOVERY_CODE_COUNT }, () => this.deps.tokens.recoveryCode());
    await this.deps.gateway.inSpace(actor.tutorSpaceId, async (store) => {
      const account = await store.accountById(actor.id);
      if (account === null || account.role === "learner" || account.mfa.status !== "enabled")
        throw new MfaNotAvailableError();
      await store.replaceRecoveryCodes(
        account.id,
        codes.map((recovery) => this.deps.tokens.hash(recovery)),
        codes.map(() => this.deps.ids.next("RecoveryCodeId")),
      );
      await store.audit(
        auditEntry(
          this.deps,
          actor.tutorSpaceId,
          auditActorOf(actor),
          "identity.recovery-codes-renewed",
          "success",
        ),
      );
    });
    return { recoveryCodes: codes.map((recovery) => recovery.replace(/(.{4})(?=.)/g, "$1-")) };
  }
}
