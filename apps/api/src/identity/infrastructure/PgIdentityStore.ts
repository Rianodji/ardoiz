import type { Pool, PoolClient } from "pg";
import { fromUuid, toUuid } from "../../platform/ids/UuidV7IdGenerator.js";
import { withTenantTransaction } from "../../platform/postgres/withTenantTransaction.js";
import type { AuditEntry } from "../../shared-kernel/AuditTrail.js";
import type {
  AuthSessionId,
  GuardianId,
  GuardianshipId,
  LearnerId,
  TutorSpaceId,
} from "../../shared-kernel/ids.js";
import type { Account, AdultAccount, LearnerAccount, MfaState } from "../domain/Account.js";
import { AlreadyTakenError } from "../domain/errors.js";
import type { Guardianship } from "../domain/Guardianship.js";
import type { InvitationState } from "../domain/Invitation.js";
import type { ParentalConsent } from "../domain/ParentalConsent.js";
import {
  DisplayName,
  EmailAddress,
  FirstName,
  SchoolLevel,
  Username,
  type SpaceCode,
} from "../domain/values.js";
import type {
  AuditRecord,
  AuthSession,
  IdentityGateway,
  IdentityStore,
  NewTutorSpace,
  PasswordReset,
} from "../application/ports.js";

interface AccountRow {
  id: string;
  tutor_space_id: string;
  role: "tutor" | "guardian" | "learner";
  status: "active" | "disabled";
  password_hash: string;
  email: string | null;
  display_name: string | null;
  mfa_status: "none" | "pending" | "enabled" | null;
  mfa_secret_ciphertext: string | null;
  mfa_last_used_step: string | null;
  username: string | null;
  first_name: string | null;
  school_level: string | null;
  scheduled_deletion_at: Date | null;
  created_at: Date;
}

interface SessionRow {
  id: string;
  tutor_space_id: string;
  account_id: string;
  token_hash: string;
  created_at: Date;
  last_seen_at: Date;
  expires_at: Date;
  authenticated_at: Date;
  mfa_pending: boolean;
  ip_prefix: string | null;
  user_agent: string | null;
  revoked_at: Date | null;
}

interface InvitationRow {
  id: string;
  tutor_space_id: string;
  kind: "guardian" | "co_guardian";
  email: string;
  token_hash: string;
  invited_by: string;
  learner_id: string | null;
  created_at: Date;
  expires_at: Date;
  consumed_at: Date | null;
}

interface GuardianshipRow {
  id: string;
  tutor_space_id: string;
  guardian_id: string;
  learner_id: string;
  origin: "learner_creation" | "co_guardian_invitation";
  established_at: Date;
  revoked_at: Date | null;
}

interface ConsentRow {
  id: string;
  tutor_space_id: string;
  guardian_id: string;
  learner_id: string | null;
  text_version: string;
  text_sha256: string;
  given_at: Date;
  withdrawn_at: Date | null;
}

interface ResetRow {
  id: string;
  tutor_space_id: string;
  account_id: string;
  token_hash: string;
  created_at: Date;
  expires_at: Date;
  consumed_at: Date | null;
}

const ACCOUNT_COLUMNS = `id, tutor_space_id, role, status, password_hash, email, display_name, mfa_status,
  mfa_secret_ciphertext, mfa_last_used_step, username, first_name, school_level, scheduled_deletion_at, created_at`;
const SESSION_COLUMNS = `id, tutor_space_id, account_id, token_hash, created_at, last_seen_at, expires_at,
  authenticated_at, mfa_pending, ip_prefix, user_agent, revoked_at`;
const INVITATION_COLUMNS = `id, tutor_space_id, kind, email, token_hash, invited_by, learner_id, created_at, expires_at, consumed_at`;
const GUARDIANSHIP_COLUMNS = `id, tutor_space_id, guardian_id, learner_id, origin, established_at, revoked_at`;

/** Préfixe de l'identifiant d'un compte, selon son rôle. */
const ACCOUNT_KIND = { tutor: "TutorId", guardian: "GuardianId", learner: "LearnerId" } as const;

/**
 * Relecture d'une ligne : chaque valeur repasse par son Value Object ; une donnée corrompue
 * en base est rejetée plutôt que propagée (règle 5).
 */
function toAccount(row: AccountRow): Account {
  const base = {
    tutorSpaceId: fromUuid("TutorSpaceId", row.tutor_space_id),
    status: row.status,
    passwordHash: row.password_hash,
    createdAt: row.created_at,
  };
  if (row.role === "learner") {
    return {
      ...base,
      role: "learner",
      id: fromUuid("LearnerId", row.id),
      username: Username(row.username),
      firstName: FirstName(row.first_name),
      schoolLevel: SchoolLevel(row.school_level),
      scheduledDeletionAt: row.scheduled_deletion_at,
    };
  }
  const mfa: MfaState =
    row.mfa_status === "enabled" && row.mfa_secret_ciphertext !== null
      ? {
          status: "enabled",
          secretCiphertext: row.mfa_secret_ciphertext,
          lastUsedStep: row.mfa_last_used_step === null ? null : Number(row.mfa_last_used_step),
        }
      : row.mfa_status === "pending" && row.mfa_secret_ciphertext !== null
        ? { status: "pending", secretCiphertext: row.mfa_secret_ciphertext }
        : { status: "none" };
  const adult = { ...base, email: EmailAddress(row.email), displayName: DisplayName(row.display_name), mfa };
  return row.role === "tutor"
    ? { ...adult, role: "tutor", id: fromUuid("TutorId", row.id) }
    : { ...adult, role: "guardian", id: fromUuid("GuardianId", row.id) };
}

function toSession(row: SessionRow): AuthSession {
  return {
    id: fromUuid("AuthSessionId", row.id),
    tutorSpaceId: fromUuid("TutorSpaceId", row.tutor_space_id),
    accountId: row.account_id,
    tokenHash: row.token_hash,
    createdAt: row.created_at,
    lastSeenAt: row.last_seen_at,
    expiresAt: row.expires_at,
    authenticatedAt: row.authenticated_at,
    mfaPending: row.mfa_pending,
    ipPrefix: row.ip_prefix,
    userAgent: row.user_agent,
    revokedAt: row.revoked_at,
  };
}

function toInvitation(row: InvitationRow): InvitationState {
  return {
    id: fromUuid("InvitationId", row.id),
    tutorSpaceId: fromUuid("TutorSpaceId", row.tutor_space_id),
    kind: row.kind,
    email: EmailAddress(row.email),
    tokenHash: row.token_hash,
    invitedBy:
      row.kind === "guardian" ? fromUuid("TutorId", row.invited_by) : fromUuid("GuardianId", row.invited_by),
    learnerId: row.learner_id === null ? null : fromUuid("LearnerId", row.learner_id),
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    consumedAt: row.consumed_at,
  };
}

function toGuardianship(row: GuardianshipRow): Guardianship {
  return {
    id: fromUuid("GuardianshipId", row.id),
    tutorSpaceId: fromUuid("TutorSpaceId", row.tutor_space_id),
    guardianId: fromUuid("GuardianId", row.guardian_id),
    learnerId: fromUuid("LearnerId", row.learner_id),
    origin: row.origin,
    establishedAt: row.established_at,
    revokedAt: row.revoked_at,
  };
}

/** Le compte est stocké sous son uuid ; le code le manipule toujours préfixé selon son rôle. */
async function accountIdForRole(client: PoolClient, uuid: string): Promise<string | null> {
  const { rows } = await client.query<{ role: keyof typeof ACCOUNT_KIND }>(
    "SELECT role FROM identity.accounts WHERE id = $1",
    [uuid],
  );
  const role = rows[0]?.role;
  return role === undefined ? null : fromUuid(ACCOUNT_KIND[role], uuid);
}

/** Une violation d'unicité devient une erreur métier explicite, sans la valeur en cause (R21). */
async function translatingUniqueViolations(work: () => Promise<unknown>): Promise<void> {
  try {
    await work();
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "23505" && "constraint" in error) {
      if (error.constraint === "accounts_email_key") throw new AlreadyTakenError("identity.email-taken");
      if (error.constraint === "accounts_tutor_space_id_username_key")
        throw new AlreadyTakenError("identity.username-taken");
      if (error.constraint === "tutor_spaces_code_key")
        throw new AlreadyTakenError("identity.space-code-taken");
    }
    throw error;
  }
}

/** Adaptateur PostgreSQL du port `IdentityStore`, lié à la connexion d'une transaction d'espace. */
export class PgIdentityStore implements IdentityStore {
  constructor(private readonly client: PoolClient) {}

  async insertSpace(space: NewTutorSpace): Promise<void> {
    await translatingUniqueViolations(() =>
      this.client.query(
        "INSERT INTO tenancy.tutor_spaces (id, name, code, created_at) VALUES ($1, $2, $3, $4)",
        [toUuid(space.id), space.name, space.code, space.createdAt],
      ),
    );
  }

  async accountById(id: string): Promise<Account | null> {
    const { rows } = await this.client.query<AccountRow>(
      `SELECT ${ACCOUNT_COLUMNS} FROM identity.accounts WHERE id = $1`,
      [toUuid(id)],
    );
    return rows[0] === undefined ? null : toAccount(rows[0]);
  }

  async adultByEmail(email: EmailAddress): Promise<AdultAccount | null> {
    const { rows } = await this.client.query<AccountRow>(
      `SELECT ${ACCOUNT_COLUMNS} FROM identity.accounts WHERE email = $1 AND role IN ('tutor', 'guardian')`,
      [email],
    );
    const account = rows[0] === undefined ? null : toAccount(rows[0]);
    return account === null || account.role === "learner" ? null : account;
  }

  async learnerByUsername(username: Username): Promise<LearnerAccount | null> {
    const { rows } = await this.client.query<AccountRow>(
      `SELECT ${ACCOUNT_COLUMNS} FROM identity.accounts WHERE username = $1 AND role = 'learner'`,
      [username],
    );
    const account = rows[0] === undefined ? null : toAccount(rows[0]);
    return account?.role === "learner" ? account : null;
  }

  async listAccounts(): Promise<Account[]> {
    const { rows } = await this.client.query<AccountRow>(
      `SELECT ${ACCOUNT_COLUMNS} FROM identity.accounts ORDER BY created_at, id`,
    );
    return rows.map(toAccount);
  }

  async insertAccount(account: Account): Promise<void> {
    const adult = account.role === "learner" ? null : account;
    const learner = account.role === "learner" ? account : null;
    const mfa = adult?.mfa;
    await translatingUniqueViolations(() =>
      this.client.query(
        `INSERT INTO identity.accounts (id, tutor_space_id, role, status, password_hash, email, display_name, mfa_status,
           mfa_secret_ciphertext, mfa_last_used_step, username, first_name, school_level, scheduled_deletion_at, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)`,
        [
          toUuid(account.id),
          toUuid(account.tutorSpaceId),
          account.role,
          account.status,
          account.passwordHash,
          adult?.email ?? null,
          adult?.displayName ?? null,
          mfa?.status ?? null,
          mfa === undefined || mfa.status === "none" ? null : mfa.secretCiphertext,
          mfa?.status === "enabled" ? mfa.lastUsedStep : null,
          learner?.username ?? null,
          learner?.firstName ?? null,
          learner?.schoolLevel ?? null,
          learner?.scheduledDeletionAt ?? null,
          account.createdAt,
        ],
      ),
    );
  }

  async updateAccount(account: Account): Promise<void> {
    const adult = account.role === "learner" ? null : account;
    const mfa = adult?.mfa;
    await this.client.query(
      `UPDATE identity.accounts
          SET status = $2, password_hash = $3, display_name = $4, mfa_status = $5, mfa_secret_ciphertext = $6,
              mfa_last_used_step = $7, scheduled_deletion_at = $8
        WHERE id = $1`,
      [
        toUuid(account.id),
        account.status,
        account.passwordHash,
        adult?.displayName ?? null,
        mfa?.status ?? null,
        mfa === undefined || mfa.status === "none" ? null : mfa.secretCiphertext,
        mfa?.status === "enabled" ? mfa.lastUsedStep : null,
        account.role === "learner" ? account.scheduledDeletionAt : null,
      ],
    );
  }

  async insertSession(session: AuthSession): Promise<void> {
    await this.client.query(
      `INSERT INTO identity.auth_sessions (${SESSION_COLUMNS}) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
      [
        toUuid(session.id),
        toUuid(session.tutorSpaceId),
        toUuid(session.accountId),
        session.tokenHash,
        session.createdAt,
        session.lastSeenAt,
        session.expiresAt,
        session.authenticatedAt,
        session.mfaPending,
        session.ipPrefix,
        session.userAgent,
        session.revokedAt,
      ],
    );
  }

  async sessionById(id: AuthSessionId): Promise<AuthSession | null> {
    const { rows } = await this.client.query<SessionRow>(
      `SELECT ${SESSION_COLUMNS} FROM identity.auth_sessions WHERE id = $1`,
      [toUuid(id)],
    );
    return rows[0] === undefined ? null : this.#withAccountId(toSession(rows[0]));
  }

  async updateSession(session: AuthSession): Promise<void> {
    await this.client.query(
      `UPDATE identity.auth_sessions SET last_seen_at = $2, authenticated_at = $3, mfa_pending = $4, revoked_at = $5 WHERE id = $1`,
      [
        toUuid(session.id),
        session.lastSeenAt,
        session.authenticatedAt,
        session.mfaPending,
        session.revokedAt,
      ],
    );
  }

  async sessionsOf(accountId: string): Promise<AuthSession[]> {
    const { rows } = await this.client.query<SessionRow>(
      `SELECT ${SESSION_COLUMNS} FROM identity.auth_sessions WHERE account_id = $1 AND revoked_at IS NULL ORDER BY created_at DESC`,
      [toUuid(accountId)],
    );
    return Promise.all(rows.map((row) => this.#withAccountId(toSession(row))));
  }

  async revokeSessionsOf(accountId: string, now: Date): Promise<void> {
    await this.client.query(
      "UPDATE identity.auth_sessions SET revoked_at = $2 WHERE account_id = $1 AND revoked_at IS NULL",
      [toUuid(accountId), now],
    );
  }

  async replaceRecoveryCodes(
    accountId: string,
    codeHashes: readonly string[],
    ids: readonly string[],
  ): Promise<void> {
    const { rows } = await this.client.query<{ tutor_space_id: string }>(
      "SELECT tutor_space_id FROM identity.accounts WHERE id = $1",
      [toUuid(accountId)],
    );
    const space = rows[0]?.tutor_space_id;
    if (space === undefined) throw new Error("Compte introuvable pour les codes de secours.");
    await this.client.query("DELETE FROM identity.recovery_codes WHERE account_id = $1", [toUuid(accountId)]);
    for (const [index, hash] of codeHashes.entries()) {
      await this.client.query(
        "INSERT INTO identity.recovery_codes (id, tutor_space_id, account_id, code_hash) VALUES ($1, $2, $3, $4)",
        [toUuid(ids[index] ?? ""), space, toUuid(accountId), hash],
      );
    }
  }

  async useRecoveryCode(accountId: string, codeHash: string, now: Date): Promise<boolean> {
    const result = await this.client.query(
      "UPDATE identity.recovery_codes SET used_at = $3 WHERE account_id = $1 AND code_hash = $2 AND used_at IS NULL",
      [toUuid(accountId), codeHash, now],
    );
    return result.rowCount === 1;
  }

  async insertInvitation(invitation: InvitationState): Promise<void> {
    await this.client.query(
      `INSERT INTO identity.invitations (${INVITATION_COLUMNS}) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        toUuid(invitation.id),
        toUuid(invitation.tutorSpaceId),
        invitation.kind,
        invitation.email,
        invitation.tokenHash,
        toUuid(invitation.invitedBy),
        invitation.learnerId === null ? null : toUuid(invitation.learnerId),
        invitation.createdAt,
        invitation.expiresAt,
        invitation.consumedAt,
      ],
    );
  }

  async invitationByTokenHash(tokenHash: string): Promise<InvitationState | null> {
    const { rows } = await this.client.query<InvitationRow>(
      `SELECT ${INVITATION_COLUMNS} FROM identity.invitations WHERE token_hash = $1`,
      [tokenHash],
    );
    return rows[0] === undefined ? null : toInvitation(rows[0]);
  }

  async consumeInvitation(invitation: InvitationState): Promise<void> {
    // La condition « consumed_at IS NULL » rend la consommation atomique : deux acceptations
    // simultanées du même jeton ne peuvent pas réussir toutes les deux (R1).
    const result = await this.client.query(
      "UPDATE identity.invitations SET consumed_at = $2 WHERE id = $1 AND consumed_at IS NULL",
      [toUuid(invitation.id), invitation.consumedAt],
    );
    if (result.rowCount !== 1) throw new Error("Invitation déjà consommée.");
  }

  async insertGuardianship(link: Guardianship): Promise<void> {
    await this.client.query(
      `INSERT INTO identity.guardianships (${GUARDIANSHIP_COLUMNS}) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        toUuid(link.id),
        toUuid(link.tutorSpaceId),
        toUuid(link.guardianId),
        toUuid(link.learnerId),
        link.origin,
        link.establishedAt,
        link.revokedAt,
      ],
    );
  }

  async guardianshipById(id: GuardianshipId): Promise<Guardianship | null> {
    const { rows } = await this.client.query<GuardianshipRow>(
      `SELECT ${GUARDIANSHIP_COLUMNS} FROM identity.guardianships WHERE id = $1`,
      [toUuid(id)],
    );
    return rows[0] === undefined ? null : toGuardianship(rows[0]);
  }

  async guardianshipsOfLearner(learnerId: LearnerId): Promise<Guardianship[]> {
    const { rows } = await this.client.query<GuardianshipRow>(
      `SELECT ${GUARDIANSHIP_COLUMNS} FROM identity.guardianships WHERE learner_id = $1 ORDER BY established_at`,
      [toUuid(learnerId)],
    );
    return rows.map(toGuardianship);
  }

  async guardianshipsOfGuardian(guardianId: GuardianId): Promise<Guardianship[]> {
    const { rows } = await this.client.query<GuardianshipRow>(
      `SELECT ${GUARDIANSHIP_COLUMNS} FROM identity.guardianships WHERE guardian_id = $1 ORDER BY established_at`,
      [toUuid(guardianId)],
    );
    return rows.map(toGuardianship);
  }

  async allGuardianships(): Promise<Guardianship[]> {
    const { rows } = await this.client.query<GuardianshipRow>(
      `SELECT ${GUARDIANSHIP_COLUMNS} FROM identity.guardianships ORDER BY established_at`,
    );
    return rows.map(toGuardianship);
  }

  async revokeGuardianship(link: Guardianship): Promise<void> {
    await this.client.query(
      "UPDATE identity.guardianships SET revoked_at = $2 WHERE id = $1 AND revoked_at IS NULL",
      [toUuid(link.id), link.revokedAt],
    );
  }

  async insertConsent(consent: ParentalConsent): Promise<void> {
    await this.client.query(
      `INSERT INTO identity.parental_consents (id, tutor_space_id, guardian_id, learner_id, text_version, text_sha256, given_at, withdrawn_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        toUuid(consent.id),
        toUuid(consent.tutorSpaceId),
        toUuid(consent.guardianId),
        consent.learnerId === null ? null : toUuid(consent.learnerId),
        consent.textVersion,
        consent.textSha256,
        consent.givenAt,
        consent.withdrawnAt,
      ],
    );
  }

  async consentsOfGuardian(guardianId: GuardianId): Promise<ParentalConsent[]> {
    const { rows } = await this.client.query<ConsentRow>(
      `SELECT id, tutor_space_id, guardian_id, learner_id, text_version, text_sha256, given_at, withdrawn_at
         FROM identity.parental_consents WHERE guardian_id = $1 ORDER BY given_at`,
      [toUuid(guardianId)],
    );
    return rows.map((row) => ({
      id: fromUuid("ParentalConsentId", row.id),
      tutorSpaceId: fromUuid("TutorSpaceId", row.tutor_space_id),
      guardianId: fromUuid("GuardianId", row.guardian_id),
      learnerId: row.learner_id === null ? null : fromUuid("LearnerId", row.learner_id),
      textVersion: row.text_version,
      textSha256: row.text_sha256,
      givenAt: row.given_at,
      withdrawnAt: row.withdrawn_at,
    }));
  }

  async withdrawConsentsForLearner(learnerId: LearnerId, now: Date): Promise<void> {
    await this.client.query(
      "UPDATE identity.parental_consents SET withdrawn_at = $2 WHERE learner_id = $1 AND withdrawn_at IS NULL",
      [toUuid(learnerId), now],
    );
  }

  async insertPasswordReset(reset: PasswordReset): Promise<void> {
    await this.client.query(
      `INSERT INTO identity.password_resets (id, tutor_space_id, account_id, token_hash, created_at, expires_at, consumed_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        toUuid(reset.id),
        toUuid(reset.tutorSpaceId),
        toUuid(reset.accountId),
        reset.tokenHash,
        reset.createdAt,
        reset.expiresAt,
        reset.consumedAt,
      ],
    );
  }

  async passwordResetByTokenHash(tokenHash: string): Promise<PasswordReset | null> {
    const { rows } = await this.client.query<ResetRow>(
      `SELECT id, tutor_space_id, account_id, token_hash, created_at, expires_at, consumed_at
         FROM identity.password_resets WHERE token_hash = $1`,
      [tokenHash],
    );
    const row = rows[0];
    if (row === undefined) return null;
    const accountId = await accountIdForRole(this.client, row.account_id);
    if (accountId === null) return null;
    return {
      id: fromUuid("PasswordResetId", row.id),
      tutorSpaceId: fromUuid("TutorSpaceId", row.tutor_space_id),
      accountId,
      tokenHash: row.token_hash,
      createdAt: row.created_at,
      expiresAt: row.expires_at,
      consumedAt: row.consumed_at,
    };
  }

  async consumePasswordReset(reset: PasswordReset, now: Date): Promise<void> {
    const result = await this.client.query(
      "UPDATE identity.password_resets SET consumed_at = $2 WHERE id = $1 AND consumed_at IS NULL",
      [toUuid(reset.id), now],
    );
    if (result.rowCount !== 1) throw new Error("Réinitialisation déjà consommée.");
  }

  async audit(entry: AuditEntry): Promise<void> {
    await this.client.query(
      `INSERT INTO audit.audit_log (id, tutor_space_id, occurred_at, action, actor_kind, actor_id, target_id, outcome, reason_code)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        toUuid(entry.id),
        toUuid(entry.tutorSpaceId),
        entry.occurredAt,
        entry.action,
        entry.actor.kind,
        entry.actor.kind === "system" ? null : entry.actor.id,
        entry.targetId ?? null,
        entry.outcome,
        entry.reasonCode ?? null,
      ],
    );
  }

  async latestAudit(limit: number): Promise<AuditRecord[]> {
    const { rows } = await this.client.query<{
      occurred_at: Date;
      action: string;
      actor_kind: string;
      actor_id: string | null;
      target_id: string | null;
      outcome: string;
      reason_code: string | null;
    }>(
      `SELECT occurred_at, action, actor_kind, actor_id, target_id, outcome, reason_code
         FROM audit.audit_log ORDER BY occurred_at DESC, id DESC LIMIT $1`,
      [limit],
    );
    return rows.map((row) => ({
      occurredAt: row.occurred_at,
      action: row.action,
      actorKind: row.actor_kind,
      actorId: row.actor_id,
      targetId: row.target_id,
      outcome: row.outcome,
      reasonCode: row.reason_code,
    }));
  }

  async #withAccountId(session: AuthSession): Promise<AuthSession> {
    const accountId = await accountIdForRole(this.client, session.accountId);
    if (accountId === null) throw new Error("Session sans compte.");
    return { ...session, accountId };
  }
}

/** Passerelle : transactions d'espace et recherches transverses par fonctions étroites (migration 002). */
export class PgIdentityGateway implements IdentityGateway {
  constructor(private readonly pool: Pool) {}

  inSpace<T>(tutorSpaceId: TutorSpaceId, work: (store: IdentityStore) => Promise<T>): Promise<T> {
    return withTenantTransaction(this.pool, tutorSpaceId, (client) => work(new PgIdentityStore(client)));
  }

  async spaceByCode(code: SpaceCode): Promise<TutorSpaceId | null> {
    const { rows } = await this.pool.query<{ id: string | null }>(
      "SELECT identity.find_space_by_code($1) AS id",
      [code],
    );
    const id = rows[0]?.id;
    return id === undefined || id === null ? null : fromUuid("TutorSpaceId", id);
  }

  async adultByEmail(email: EmailAddress): Promise<{ tutorSpaceId: TutorSpaceId; accountId: string } | null> {
    const { rows } = await this.pool.query<{ tutor_space_id: string; account_id: string }>(
      "SELECT tutor_space_id, account_id FROM identity.find_adult_by_email($1)",
      [email],
    );
    const row = rows[0];
    return row === undefined
      ? null
      : { tutorSpaceId: fromUuid("TutorSpaceId", row.tutor_space_id), accountId: row.account_id };
  }

  async sessionByTokenHash(
    tokenHash: string,
  ): Promise<{ tutorSpaceId: TutorSpaceId; sessionId: AuthSessionId } | null> {
    const { rows } = await this.pool.query<{ tutor_space_id: string; session_id: string }>(
      "SELECT tutor_space_id, session_id FROM identity.find_session($1)",
      [tokenHash],
    );
    const row = rows[0];
    return row === undefined
      ? null
      : {
          tutorSpaceId: fromUuid("TutorSpaceId", row.tutor_space_id),
          sessionId: fromUuid("AuthSessionId", row.session_id),
        };
  }

  async invitationSpace(tokenHash: string): Promise<TutorSpaceId | null> {
    const { rows } = await this.pool.query<{ id: string | null }>(
      "SELECT identity.find_invitation($1) AS id",
      [tokenHash],
    );
    const id = rows[0]?.id;
    return id === undefined || id === null ? null : fromUuid("TutorSpaceId", id);
  }

  async passwordResetSpace(tokenHash: string): Promise<TutorSpaceId | null> {
    const { rows } = await this.pool.query<{ id: string | null }>(
      "SELECT identity.find_password_reset($1) AS id",
      [tokenHash],
    );
    const id = rows[0]?.id;
    return id === undefined || id === null ? null : fromUuid("TutorSpaceId", id);
  }
}
