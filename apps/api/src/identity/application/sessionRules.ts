import type { Account } from "../domain/Account.js";

/** Expiration après inactivité (R8) : 30 min pour un élève, 2 h pour un adulte. */
export const IDLE_TIMEOUT_MS: Readonly<Record<Account["role"], number>> = {
  learner: 30 * 60 * 1000,
  guardian: 2 * 60 * 60 * 1000,
  tutor: 2 * 60 * 60 * 1000,
};

// QUESTION Q12 : la durée de vie maximale d'une session n'est pas fixée ; 12 h par défaut
// (option restrictive : une session oubliée ne survit pas à la nuit).
export const ABSOLUTE_LIFETIME_MS = 12 * 60 * 60 * 1000;

/** Réauthentification exigée pour une action sensible au-delà de 10 minutes (R7). */
export const STEP_UP_WINDOW_MS = 10 * 60 * 1000;

/** Délai d'un code TOTP en attente après le mot de passe. */
export const MFA_PENDING_WINDOW_MS = 5 * 60 * 1000;

/** Jeton de réinitialisation d'un mot de passe adulte : 30 minutes (jalons L1). */
export const PASSWORD_RESET_LIFETIME_MS = 30 * 60 * 1000;

export function isSessionAlive(
  session: {
    lastSeenAt: Date;
    expiresAt: Date;
    revokedAt: Date | null;
    mfaPending: boolean;
    authenticatedAt: Date;
  },
  role: Account["role"],
  now: Date,
): boolean {
  if (session.revokedAt !== null) return false;
  if (now.getTime() >= session.expiresAt.getTime()) return false;
  if (now.getTime() - session.lastSeenAt.getTime() >= IDLE_TIMEOUT_MS[role]) return false;
  if (session.mfaPending && now.getTime() - session.authenticatedAt.getTime() >= MFA_PENDING_WINDOW_MS)
    return false;
  return true;
}
