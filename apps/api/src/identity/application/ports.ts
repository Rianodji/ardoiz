import type {
  AuthSessionId,
  GuardianId,
  GuardianshipId,
  LearnerId,
  TutorSpaceId,
} from "../../shared-kernel/ids.js";
import type { AuditEntry } from "../../shared-kernel/AuditTrail.js";
import type { Account, AdultAccount, LearnerAccount } from "../domain/Account.js";
import type { Guardianship } from "../domain/Guardianship.js";
import type { InvitationState } from "../domain/Invitation.js";
import type { ConsentText, ParentalConsent } from "../domain/ParentalConsent.js";
import type { DisplayName, EmailAddress, SpaceCode, Username } from "../domain/values.js";

/** Session serveur (ADR-0006) : le navigateur ne détient qu'un identifiant opaque, la base son empreinte. */
export interface AuthSession {
  readonly id: AuthSessionId;
  readonly tutorSpaceId: TutorSpaceId;
  readonly accountId: string;
  readonly tokenHash: string;
  readonly createdAt: Date;
  readonly lastSeenAt: Date;
  readonly expiresAt: Date;
  readonly authenticatedAt: Date;
  /** Mot de passe vérifié, code TOTP encore attendu : la session ne donne accès à rien d'autre. */
  readonly mfaPending: boolean;
  readonly ipPrefix: string | null;
  readonly userAgent: string | null;
  readonly revokedAt: Date | null;
}

export interface PasswordReset {
  readonly id: string;
  readonly tutorSpaceId: TutorSpaceId;
  readonly accountId: string;
  readonly tokenHash: string;
  readonly createdAt: Date;
  readonly expiresAt: Date;
  readonly consumedAt: Date | null;
}

export interface NewTutorSpace {
  readonly id: TutorSpaceId;
  readonly name: string;
  readonly code: SpaceCode;
  readonly createdAt: Date;
}

/** Accès aux données d'identité d'UN espace, dans une transaction déclarée à la RLS (R10). */
export interface IdentityStore {
  insertSpace(space: NewTutorSpace): Promise<void>;

  accountById(id: string): Promise<Account | null>;
  adultByEmail(email: EmailAddress): Promise<AdultAccount | null>;
  learnerByUsername(username: Username): Promise<LearnerAccount | null>;
  listAccounts(): Promise<Account[]>;
  insertAccount(account: Account): Promise<void>;
  updateAccount(account: Account): Promise<void>;

  insertSession(session: AuthSession): Promise<void>;
  sessionById(id: AuthSessionId): Promise<AuthSession | null>;
  updateSession(session: AuthSession): Promise<void>;
  sessionsOf(accountId: string): Promise<AuthSession[]>;
  revokeSessionsOf(accountId: string, now: Date): Promise<void>;
  /** Révoque les sessions qui attendent encore leur code TOTP. */
  revokePendingSessionsOf(accountId: string, now: Date): Promise<void>;
  /**
   * Consomme un pas de temps TOTP, atomiquement : réussit seulement s'il est postérieur au dernier
   * pas utilisé. Deux requêtes simultanées avec le même code ne passent pas toutes les deux (R7).
   */
  useTotpStep(accountId: string, step: number): Promise<boolean>;

  replaceRecoveryCodes(
    accountId: string,
    codeHashes: readonly string[],
    ids: readonly string[],
  ): Promise<void>;
  useRecoveryCode(accountId: string, codeHash: string, now: Date): Promise<boolean>;

  insertInvitation(invitation: InvitationState): Promise<void>;
  invitationByTokenHash(tokenHash: string): Promise<InvitationState | null>;
  consumeInvitation(invitation: InvitationState): Promise<void>;

  insertGuardianship(link: Guardianship): Promise<void>;
  guardianshipById(id: GuardianshipId): Promise<Guardianship | null>;
  guardianshipsOfLearner(learnerId: LearnerId): Promise<Guardianship[]>;
  guardianshipsOfGuardian(guardianId: GuardianId): Promise<Guardianship[]>;
  allGuardianships(): Promise<Guardianship[]>;
  revokeGuardianship(link: Guardianship): Promise<void>;

  insertConsent(consent: ParentalConsent): Promise<void>;
  consentsOfGuardian(guardianId: GuardianId): Promise<ParentalConsent[]>;
  withdrawConsentsForLearner(learnerId: LearnerId, now: Date): Promise<void>;

  insertPasswordReset(reset: PasswordReset): Promise<void>;
  passwordResetByTokenHash(tokenHash: string): Promise<PasswordReset | null>;
  consumePasswordReset(reset: PasswordReset, now: Date): Promise<void>;
  /** Une nouvelle demande rend caducs les liens de réinitialisation précédents du compte. */
  invalidatePasswordResetsOf(accountId: string, now: Date): Promise<void>;

  audit(entry: AuditEntry): Promise<void>;
  /** Dernières entrées du journal d'audit de l'espace, les plus récentes d'abord. */
  latestAudit(limit: number): Promise<AuditRecord[]>;
}

export interface AuditRecord {
  readonly occurredAt: Date;
  readonly action: string;
  readonly actorKind: string;
  readonly actorId: string | null;
  readonly targetId: string | null;
  readonly outcome: string;
  readonly reasonCode: string | null;
}

/**
 * Les seules recherches qui traversent les espaces, avant que l'espace soit connu (connexion,
 * cookie, jetons). Elles ne renvoient que des identifiants ; tout le reste se lit sous RLS.
 */
export interface IdentityGateway {
  inSpace<T>(tutorSpaceId: TutorSpaceId, work: (store: IdentityStore) => Promise<T>): Promise<T>;
  spaceByCode(code: SpaceCode): Promise<TutorSpaceId | null>;
  adultByEmail(email: EmailAddress): Promise<{ tutorSpaceId: TutorSpaceId; accountId: string } | null>;
  sessionByTokenHash(
    tokenHash: string,
  ): Promise<{ tutorSpaceId: TutorSpaceId; sessionId: AuthSessionId } | null>;
  invitationSpace(tokenHash: string): Promise<TutorSpaceId | null>;
  passwordResetSpace(tokenHash: string): Promise<TutorSpaceId | null>;
}

export interface PasswordHasher {
  hash(password: string): Promise<string>;
  verify(hash: string, password: string): Promise<boolean>;
  /** Même coût qu'une vérification réelle, quand le compte n'existe pas : temps constant (R8). */
  verifyAgainstDummy(password: string): Promise<void>;
}

/** Jetons secrets de 256 bits ; seule leur empreinte (HMAC avec un poivre serveur) est stockée (R1, R8). */
export interface SecretTokens {
  generate(): { readonly token: string; readonly hash: string };
  hash(token: string): string;
  /** Code de secours : 16 caractères hexadécimaux (64 bits), à usage unique, saisi à la main. */
  recoveryCode(): string;
}

export interface TotpService {
  /** Nouveau secret : sa forme chiffrée (stockée) et l'URI otpauth (affichée une seule fois). */
  newSecret(label: string): {
    readonly ciphertext: string;
    readonly otpauthUri: string;
    readonly secret: string;
  };
  /** Renvoie le pas de temps accepté, ou null ; refuse un pas déjà utilisé (rejeu). */
  verify(ciphertext: string, code: string, now: Date, lastUsedStep: number | null): number | null;
}

export type OutgoingMail =
  | {
      readonly template: "guardian-invitation";
      readonly to: EmailAddress;
      readonly link: string;
      readonly tutorName: DisplayName;
    }
  | {
      readonly template: "co-guardian-invitation";
      readonly to: EmailAddress;
      readonly link: string;
      readonly inviterName: DisplayName;
    }
  | { readonly template: "password-reset"; readonly to: EmailAddress; readonly link: string }
  | {
      readonly template: "tutor-login-alert";
      readonly to: EmailAddress;
      readonly at: Date;
      readonly userAgent: string | null;
    }
  | { readonly template: "mfa-failures-alert"; readonly to: EmailAddress; readonly at: Date };

/** Port d'envoi d'e-mails (Brevo en production, Mailpit en développement). */
export interface Mailer {
  send(mail: OutgoingMail): Promise<void>;
}

export type ThrottleDecision =
  { readonly allowed: true } | { readonly allowed: false; readonly retryAfterSeconds: number };

/** Limitation des tentatives de connexion, par identifiant et par adresse IP (R8, M9). */
export interface LoginThrottle {
  check(keys: readonly string[], now: Date): ThrottleDecision;
  recordFailure(keys: readonly string[], now: Date): void;
  recordSuccess(keys: readonly string[]): void;
  /** Nombre d'échecs encore comptés pour cette clé. */
  failureCount(key: string, now: Date): number;
}

/** Quota de demandes sur une fenêtre glissante (mot de passe oublié : par adresse et par IP). */
export interface RequestQuota {
  /** Vrai si la demande entre dans le quota (et la compte), faux sinon. */
  take(key: string, limit: number, windowMs: number, now: Date): boolean;
}

/**
 * Tâches faites APRÈS la réponse, au mieux (envoi d'alertes, e-mail de réinitialisation) :
 * leur durée ne doit rien révéler (M9) et leur échec ne doit pas bloquer l'utilisateur. Un échec
 * est journalisé au niveau « error » avec un code stable, sans donnée personnelle (R21).
 */
export interface BackgroundTasks {
  run(failureCode: string, task: () => Promise<void>): void;
}

export interface ConsentTexts {
  current(): ConsentText;
}

/** Liens envoyés par e-mail : le jeton est dans le fragment, il n'atteint ni les journaux ni le Referer. */
export interface LinkBuilder {
  invitation(token: string): string;
  passwordReset(token: string): string;
}
