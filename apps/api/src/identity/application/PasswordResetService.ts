import { NotFoundError } from "../../shared-kernel/DomainError.js";
import { checkPassword } from "../domain/password.js";
import { EmailAddress } from "../domain/values.js";
import { PASSWORD_RESET_LIFETIME_MS } from "./sessionRules.js";
import { auditEntry, type IdentityDependencies } from "./support.js";

/**
 * Mot de passe oublié, pour les adultes seulement (ADR-0003 : l'élève passe par son parent).
 * La demande produit la même réponse que le compte existe ou non (R8) ; le jeton est haché,
 * valable 30 minutes et à usage unique.
 */
export class PasswordResetService {
  constructor(private readonly deps: IdentityDependencies) {}

  async request(rawEmail: unknown): Promise<void> {
    let email: EmailAddress;
    try {
      email = EmailAddress(rawEmail);
    } catch {
      return; // même réponse qu'une adresse inconnue
    }
    const found = await this.deps.gateway.adultByEmail(email);
    if (found === null) return;
    const now = this.deps.clock.now();
    const { token, hash } = this.deps.tokens.generate();
    const sent = await this.deps.gateway.inSpace(found.tutorSpaceId, async (store) => {
      const account = await store.accountById(found.accountId);
      if (account === null || account.role === "learner" || account.status !== "active") return false;
      await store.insertPasswordReset({
        id: this.deps.ids.next("PasswordResetId"),
        tutorSpaceId: found.tutorSpaceId,
        accountId: account.id,
        tokenHash: hash,
        createdAt: now,
        expiresAt: new Date(now.getTime() + PASSWORD_RESET_LIFETIME_MS),
        consumedAt: null,
      });
      return true;
    });
    if (sent)
      await this.deps.mailer.send({
        template: "password-reset",
        to: email,
        link: this.deps.links.passwordReset(token),
      });
  }

  /** Nouveau mot de passe : toutes les sessions du compte sont révoquées (R8). */
  async complete(token: string, password: string): Promise<void> {
    const hash = this.deps.tokens.hash(token);
    const spaceId = await this.deps.gateway.passwordResetSpace(hash);
    if (spaceId === null) throw new NotFoundError();
    const now = this.deps.clock.now();
    await this.deps.gateway.inSpace(spaceId, async (store) => {
      const reset = await store.passwordResetByTokenHash(hash);
      if (reset === null || reset.consumedAt !== null || now.getTime() >= reset.expiresAt.getTime())
        throw new NotFoundError();
      const account = await store.accountById(reset.accountId);
      if (account === null || account.role === "learner" || account.status !== "active")
        throw new NotFoundError();
      checkPassword(password, "adult", this.deps.commonPasswords, [account.email]);
      await store.updateAccount({ ...account, passwordHash: await this.deps.hasher.hash(password) });
      await store.consumePasswordReset(reset, now);
      await store.revokeSessionsOf(account.id, now);
      await store.audit(
        auditEntry(
          this.deps,
          spaceId,
          { kind: account.role, id: account.id },
          "identity.password-reset",
          "success",
        ),
      );
    });
  }
}
