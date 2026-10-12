import type { GuardianId, LearnerId, TutorId, TutorSpaceId } from "../../shared-kernel/ids.js";
import { AccountDisabledError } from "./errors.js";
import type { DisplayName, EmailAddress, FirstName, SchoolLevel, Username } from "./values.js";

export type AccountStatus = "active" | "disabled";

/** État de la double authentification d'un adulte (R7). */
export type MfaState =
  | { readonly status: "none" }
  | { readonly status: "pending"; readonly secretCiphertext: string }
  | { readonly status: "enabled"; readonly secretCiphertext: string; readonly lastUsedStep: number | null };

interface AccountBase {
  readonly tutorSpaceId: TutorSpaceId;
  readonly status: AccountStatus;
  readonly passwordHash: string;
  readonly createdAt: Date;
}

export interface TutorAccount extends AccountBase {
  readonly role: "tutor";
  readonly id: TutorId;
  readonly email: EmailAddress;
  readonly displayName: DisplayName;
  readonly mfa: MfaState;
}

export interface GuardianAccount extends AccountBase {
  readonly role: "guardian";
  readonly id: GuardianId;
  readonly email: EmailAddress;
  readonly displayName: DisplayName;
  readonly mfa: MfaState;
}

/** Compte élève : sans e-mail, sans date de naissance, sans photo (ADR-0003, R16). */
export interface LearnerAccount extends AccountBase {
  readonly role: "learner";
  readonly id: LearnerId;
  readonly username: Username;
  readonly firstName: FirstName;
  readonly schoolLevel: SchoolLevel;
  /** Suppression planifiée après un retrait de consentement (hotspot H9 : 30 jours). */
  readonly scheduledDeletionAt: Date | null;
}

export type Account = TutorAccount | GuardianAccount | LearnerAccount;
export type AdultAccount = TutorAccount | GuardianAccount;

/** Délai de rétractation avant suppression des données d'un élève (hotspot H9). */
export const DELETION_DELAY_MS = 30 * 24 * 60 * 60 * 1000;

export function assertActive(account: Account): void {
  if (account.status !== "active") throw new AccountDisabledError();
}

/** Le tuteur ne peut rien faire tant que le TOTP n'est pas activé (R7, M8). */
export function mfaEnrolled(account: Account): boolean {
  return account.role !== "learner" && account.mfa.status === "enabled";
}

/** Retrait du consentement : désactivation immédiate et suppression planifiée (R16, H9). */
export function disableLearner(learner: LearnerAccount, now: Date): LearnerAccount {
  return {
    ...learner,
    status: "disabled",
    scheduledDeletionAt: learner.scheduledDeletionAt ?? new Date(now.getTime() + DELETION_DELAY_MS),
  };
}
