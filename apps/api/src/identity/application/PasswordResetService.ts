import { NotFoundError } from "../../shared-kernel/DomainError.js";
import { checkPassword } from "../domain/password.js";
import { EmailAddress } from "../domain/values.js";
import { PASSWORD_RESET_LIFETIME_MS } from "./sessionRules.js";
import { auditEntry, type IdentityDependencies } from "./support.js";

/** Demandes de réinitialisation acceptées par heure, par adresse et par IP (verdict L1, R-3). */
export const RESET_REQUESTS_PER_EMAIL = 3;
export const RESET_REQUESTS_PER_IP = 10;
const QUOTA_WINDOW_MS = 60 * 60 * 1000;

/**
 * Mot de passe oublié, pour les adultes seulement (ADR-0003 : l'élève passe par son parent).
 * La demande produit la même réponse que le compte existe ou non (R8) ; le jeton est haché,
 * valable 30 minutes et à usage unique.
 */
export class PasswordResetService {
  constructor(private readonly deps: IdentityDependencies) {}

  /**
   * Toujours la même réponse, dans le même délai : l'e-mail part APRÈS la réponse, en tâche de fond
   * (verdict L1, R-3), et les quotas jouent en silence. Un tiers ne peut ni savoir si le compte
   * existe, ni inonder une boîte, ni épuiser le quota Brevo partagé avec les autres applications.
   */
  async request(rawEmail: unknown, client: { readonly ipKey: string }): Promise<void> {
    const now = this.deps.clock.now();
    if (!this.deps.quota.take(`reset-ip:${client.ipKey}`, RESET_REQUESTS_PER_IP, QUOTA_WINDOW_MS, now))
      return;
    let email: EmailAddress;
    try {
      email = EmailAddress(rawEmail);
    } catch {
      return; // même réponse qu'une adresse inconnue
    }
    // Quota par adresse, qu'elle ait un compte ou non : il ne doit rien révéler.
    if (!this.deps.quota.take(`reset-email:${email}`, RESET_REQUESTS_PER_EMAIL, QUOTA_WINDOW_MS, now)) return;
    const found = await this.deps.gateway.adultByEmail(email);
    if (found === null) return;
    const { token, hash } = this.deps.tokens.generate();
    const created = await this.deps.gateway.inSpace(found.tutorSpaceId, async (store) => {
      const account = await store.accountById(found.accountId);
      if (account === null || account.role === "learner" || account.status !== "active") return false;
      // Un seul lien valable à la fois : la nouvelle demande rend les précédentes caduques.
      await store.invalidatePasswordResetsOf(account.id, now);
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
    if (created) {
      this.deps.background.run("identity.password-reset-mail-failed", () =>
        this.deps.mailer.send({
          template: "password-reset",
          to: email,
          link: this.deps.links.passwordReset(token),
        }),
      );
    }
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
