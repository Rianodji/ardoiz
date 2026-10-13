import { NotFoundError } from "../../shared-kernel/DomainError.js";
import type { GuardianId, GuardianshipId, LearnerId } from "../../shared-kernel/ids.js";
import { disableLearner, type GuardianAccount, type LearnerAccount } from "../domain/Account.js";
import { AlreadyTakenError, ConsentRequiredError } from "../domain/errors.js";
import { isActive, revoke } from "../domain/Guardianship.js";
import { Invitation } from "../domain/Invitation.js";
import {
  requireCurrentConsent,
  type ConsentDeclaration,
  type ConsentText,
} from "../domain/ParentalConsent.js";
import { checkPassword } from "../domain/password.js";
import { DisplayName, EmailAddress, FirstName, SchoolLevel, Username } from "../domain/values.js";
import type { Actor } from "./Actor.js";
import { InvalidCredentialsError } from "./errors.js";
import {
  canCreateLearner,
  canInviteCoGuardian,
  canInviteGuardian,
  canListFamilies,
  canResetLearnerPassword,
  canRevokeGuardianship,
  canViewLearner,
  canWithdrawConsent,
} from "./policies.js";
import type { IdentityStore } from "./ports.js";
import { ABSOLUTE_LIFETIME_MS } from "./sessionRules.js";
import {
  auditActorOf,
  auditEntry,
  authorize,
  requireRecentAuthentication,
  type IdentityDependencies,
} from "./support.js";

export interface InvitationView {
  readonly kind: "guardian" | "co_guardian";
  readonly email: string;
  /** Prénom de l'enfant concerné, pour une invitation de co-parent. */
  readonly learnerFirstName: string | null;
  /** Un compte existe déjà pour cette adresse dans l'espace : il suffit de le confirmer par son mot de passe. */
  readonly accountExists: boolean;
  readonly consent: ConsentText;
}

export interface LearnerView {
  readonly id: LearnerId;
  readonly firstName: string;
  readonly username: string;
  readonly schoolLevel: string;
  readonly status: "active" | "disabled";
  /** Après un retrait du consentement : date de la suppression des données (annulable avant, S-1). */
  readonly scheduledDeletionAt: Date | null;
  readonly guardians: ReadonlyArray<{
    readonly guardianshipId: GuardianshipId;
    readonly guardianId: GuardianId;
    readonly displayName: string;
  }>;
}

export interface FamiliesView {
  readonly guardians: ReadonlyArray<{
    readonly id: GuardianId;
    readonly displayName: string;
    readonly email: string;
  }>;
  readonly learners: readonly LearnerView[];
}

/**
 * Familles : invitations, consentement, création des élèves, liens parentaux (R1, R16, ADR-0003).
 * Un lien parental ne naît que de deux façons : un parent consentant crée un élève, ou un invité
 * accepte l'invitation d'un parent DÉJÀ lié à cet élève (hotspot H1).
 */
export class FamilyService {
  constructor(private readonly deps: IdentityDependencies) {}

  /** L'élève existe-t-il dans l'espace de l'acteur ? Lu sous RLS : un autre espace ne voit rien (R10). */
  async #target(
    actor: Actor,
    learnerId: LearnerId,
  ): Promise<{ learnerId: LearnerId; existsInSpace: boolean }> {
    const learner = await this.deps.gateway.inSpace(actor.tutorSpaceId, (store) =>
      store.accountById(learnerId),
    );
    return { learnerId, existsInSpace: learner?.role === "learner" };
  }

  consentText(): ConsentText {
    return this.deps.consentTexts.current();
  }

  /** Le tuteur invite un parent (R1) : jeton de 256 bits, envoyé par e-mail, stocké haché. */
  async inviteGuardian(actor: Actor, rawEmail: unknown): Promise<void> {
    await authorize(this.deps, actor, canInviteGuardian(actor), "identity.invite-guardian");
    if (actor.kind !== "tutor") throw new NotFoundError();
    const tutorId = actor.id;
    const email = EmailAddress(rawEmail);
    const { token, hash } = this.deps.tokens.generate();
    const tutorName = await this.deps.gateway.inSpace(actor.tutorSpaceId, async (store) => {
      const invitation = Invitation.issue(
        { id: this.deps.ids.next("InvitationId"), tutorSpaceId: actor.tutorSpaceId, email, tokenHash: hash },
        { kind: "guardian", invitedBy: tutorId },
        this.deps.clock.now(),
      );
      await store.insertInvitation(invitation.snapshot);
      await store.audit(
        auditEntry(
          this.deps,
          actor.tutorSpaceId,
          auditActorOf(actor),
          "identity.invitation-issued",
          "success",
          {
            targetId: invitation.snapshot.id,
          },
        ),
      );
      const tutor = await store.accountById(tutorId);
      if (tutor === null || tutor.role !== "tutor") throw new NotFoundError();
      return tutor.displayName;
    });
    await this.deps.mailer.send({
      template: "guardian-invitation",
      to: email,
      link: this.deps.links.invitation(token),
      tutorName,
    });
  }

  /** Un parent invite un second parent pour SON enfant (R1). */
  async inviteCoGuardian(actor: Actor, learnerId: LearnerId, rawEmail: unknown): Promise<void> {
    await authorize(
      this.deps,
      actor,
      canInviteCoGuardian(actor, await this.#target(actor, learnerId)),
      "identity.invite-co-guardian",
      learnerId,
    );
    if (actor.kind !== "guardian") throw new NotFoundError();
    const guardianId = actor.id;
    const email = EmailAddress(rawEmail);
    const { token, hash } = this.deps.tokens.generate();
    const inviterName = await this.deps.gateway.inSpace(actor.tutorSpaceId, async (store) => {
      const links = await store.guardianshipsOfLearner(learnerId);
      // La politique s'appuie sur la session ; la base confirme que le lien est toujours actif.
      if (!links.some((link) => isActive(link) && link.guardianId === guardianId)) throw new NotFoundError();
      const invitation = Invitation.issue(
        { id: this.deps.ids.next("InvitationId"), tutorSpaceId: actor.tutorSpaceId, email, tokenHash: hash },
        { kind: "co_guardian", invitedBy: guardianId, learnerId },
        this.deps.clock.now(),
      );
      await store.insertInvitation(invitation.snapshot);
      await store.audit(
        auditEntry(
          this.deps,
          actor.tutorSpaceId,
          auditActorOf(actor),
          "identity.invitation-issued",
          "success",
          {
            targetId: invitation.snapshot.id,
          },
        ),
      );
      const inviter = await store.accountById(guardianId);
      if (inviter === null || inviter.role !== "guardian") throw new NotFoundError();
      return inviter.displayName;
    });
    await this.deps.mailer.send({
      template: "co-guardian-invitation",
      to: email,
      link: this.deps.links.invitation(token),
      inviterName,
    });
  }

  /** Ce que voit l'invité avant d'accepter. Jeton inconnu, consommé ou expiré : introuvable (R1). */
  async inspectInvitation(token: string): Promise<InvitationView> {
    const hash = this.deps.tokens.hash(token);
    const spaceId = await this.deps.gateway.invitationSpace(hash);
    if (spaceId === null) throw new NotFoundError();
    const now = this.deps.clock.now();
    return this.deps.gateway.inSpace(spaceId, async (store) => {
      const state = await store.invitationByTokenHash(hash);
      if (state === null) throw new NotFoundError();
      Invitation.restore(state).assertUsable(now);
      const learner = state.learnerId === null ? null : await store.accountById(state.learnerId);
      return {
        kind: state.kind,
        email: state.email,
        learnerFirstName: learner?.role === "learner" ? learner.firstName : null,
        accountExists: (await store.adultByEmail(state.email)) !== null,
        consent: this.deps.consentTexts.current(),
      };
    });
  }

  /**
   * Accepte une invitation : consentement au texte en vigueur (R16), création ou confirmation du
   * compte, lien parental pour un co-parent (R1). Le jeton est consommé dans la même transaction.
   * Renvoie l'identifiant de session ouverte pour le parent.
   */
  async acceptInvitation(
    token: string,
    input: { password: string; displayName?: string; consent: ConsentDeclaration },
    client: { ipPrefix: string | null; userAgent: string | null },
  ): Promise<{ sessionToken: string }> {
    const consent = requireCurrentConsent(input.consent, this.deps.consentTexts.current());
    const hash = this.deps.tokens.hash(token);
    const spaceId = await this.deps.gateway.invitationSpace(hash);
    if (spaceId === null) throw new NotFoundError();
    const now = this.deps.clock.now();
    const session = this.deps.tokens.generate();

    await this.deps.gateway.inSpace(spaceId, async (store) => {
      const state = await store.invitationByTokenHash(hash);
      if (state === null) throw new NotFoundError();
      const invitation = Invitation.restore(state);
      invitation.consume(now);

      const guardian = await this.#guardianFor(store, state.email, input, spaceId);
      if (state.kind === "co_guardian") {
        if (state.learnerId === null) throw new NotFoundError();
        const learnerId = state.learnerId;
        const links = await store.guardianshipsOfLearner(learnerId);
        // L'invitant doit être encore lié à l'enfant au moment de l'acceptation (R1).
        if (!links.some((link) => isActive(link) && link.guardianId === state.invitedBy))
          throw new NotFoundError();
        const learner = await store.accountById(learnerId);
        if (learner === null || learner.role !== "learner" || learner.status !== "active")
          throw new NotFoundError();
        if (!links.some((link) => isActive(link) && link.guardianId === guardian.id)) {
          await this.#link(store, guardian, learnerId, "co_guardian_invitation");
        }
        await this.#recordConsent(store, guardian, learnerId, consent);
      } else {
        await this.#recordConsent(store, guardian, null, consent);
      }
      await store.consumeInvitation(invitation.snapshot);
      await store.insertSession({
        id: this.deps.ids.next("AuthSessionId"),
        tutorSpaceId: spaceId,
        accountId: guardian.id,
        tokenHash: session.hash,
        createdAt: now,
        lastSeenAt: now,
        expiresAt: new Date(now.getTime() + ABSOLUTE_LIFETIME_MS),
        authenticatedAt: now,
        mfaPending: guardian.mfa.status === "enabled",
        ipPrefix: client.ipPrefix,
        userAgent: client.userAgent,
        revokedAt: null,
      });
    });
    return { sessionToken: session.token };
  }

  /**
   * Un parent consentant crée le compte de son enfant (R1, ADR-0003) : prénom seul, pseudo,
   * niveau scolaire, mot de passe ; aucune date de naissance (R16).
   */
  async createLearner(
    actor: Actor,
    input: {
      firstName: unknown;
      username: unknown;
      schoolLevel: unknown;
      password: string;
      consent: ConsentDeclaration;
    },
  ): Promise<{ learnerId: LearnerId }> {
    await authorize(this.deps, actor, canCreateLearner(actor), "identity.create-learner");
    if (actor.kind !== "guardian") throw new NotFoundError();
    const guardianId = actor.id;
    const consent = requireCurrentConsent(input.consent, this.deps.consentTexts.current());
    const firstName = FirstName(input.firstName);
    const username = Username(input.username);
    const schoolLevel = SchoolLevel(input.schoolLevel);
    checkPassword(input.password, "learner", this.deps.commonPasswords, [username, firstName]);
    const passwordHash = await this.deps.hasher.hash(input.password);
    const now = this.deps.clock.now();
    const learnerId = this.deps.ids.next("LearnerId");

    await this.deps.gateway.inSpace(actor.tutorSpaceId, async (store) => {
      const guardian = await store.accountById(guardianId);
      if (guardian === null || guardian.role !== "guardian" || guardian.status !== "active")
        throw new NotFoundError();
      // Seul un parent qui a donné son consentement à l'acceptation de l'invitation crée un élève (R1, R16).
      const consents = await store.consentsOfGuardian(guardianId);
      if (!consents.some((given) => given.learnerId === null && given.withdrawnAt === null))
        throw new ConsentRequiredError();
      if ((await store.learnerByUsername(username)) !== null)
        throw new AlreadyTakenError("identity.username-taken");
      const learner: LearnerAccount = {
        role: "learner",
        id: learnerId,
        tutorSpaceId: actor.tutorSpaceId,
        status: "active",
        passwordHash,
        createdAt: now,
        username,
        firstName,
        schoolLevel,
        scheduledDeletionAt: null,
      };
      await store.insertAccount(learner);
      await this.#link(store, guardian, learnerId, "learner_creation");
      await this.#recordConsent(store, guardian, learnerId, consent);
    });
    return { learnerId };
  }

  /** Nouveau mot de passe d'un élève, par un parent lié ou par le tuteur ; ses sessions sont révoquées. */
  async resetLearnerPassword(actor: Actor, learnerId: LearnerId, password: string): Promise<void> {
    await authorize(
      this.deps,
      actor,
      canResetLearnerPassword(actor, await this.#target(actor, learnerId)),
      "identity.reset-learner-password",
      learnerId,
    );
    requireRecentAuthentication(actor, this.deps.clock.now());
    const now = this.deps.clock.now();
    await this.deps.gateway.inSpace(actor.tutorSpaceId, async (store) => {
      const learner = await store.accountById(learnerId);
      if (learner === null || learner.role !== "learner") throw new NotFoundError();
      checkPassword(password, "learner", this.deps.commonPasswords, [learner.username, learner.firstName]);
      await store.updateAccount({ ...learner, passwordHash: await this.deps.hasher.hash(password) });
      await store.revokeSessionsOf(learner.id, now);
      await store.audit(
        auditEntry(
          this.deps,
          actor.tutorSpaceId,
          auditActorOf(actor),
          "identity.learner-password-reset",
          "success",
          {
            targetId: learnerId,
          },
        ),
      );
    });
  }

  /**
   * Retrait du consentement par un parent lié : l'élève est désactivé immédiatement, ses sessions
   * sont révoquées et la suppression de ses données est planifiée à 30 jours (R16, hotspot H9).
   */
  async withdrawConsent(actor: Actor, learnerId: LearnerId): Promise<void> {
    await authorize(
      this.deps,
      actor,
      canWithdrawConsent(actor, await this.#target(actor, learnerId)),
      "identity.withdraw-consent",
      learnerId,
    );
    const now = this.deps.clock.now();
    await this.deps.gateway.inSpace(actor.tutorSpaceId, async (store) => {
      const learner = await store.accountById(learnerId);
      if (learner === null || learner.role !== "learner") throw new NotFoundError();
      await store.withdrawConsentsForLearner(learnerId, now);
      await store.updateAccount(disableLearner(learner, now));
      await store.revokeSessionsOf(learnerId, now);
      await store.audit(
        auditEntry(
          this.deps,
          actor.tutorSpaceId,
          auditActorOf(actor),
          "identity.consent-withdrawn",
          "success",
          {
            targetId: learnerId,
          },
        ),
      );
    });
  }

  /** Révocation d'un lien parental, par le tuteur ou par un parent de l'élève (R1, R12). */
  async revokeGuardianship(actor: Actor, guardianshipId: GuardianshipId): Promise<void> {
    const now = this.deps.clock.now();
    const link = await this.deps.gateway.inSpace(actor.tutorSpaceId, (store) =>
      store.guardianshipById(guardianshipId),
    );
    if (link === null) {
      await authorize(this.deps, actor, { kind: "hide" }, "identity.revoke-guardianship", guardianshipId);
      return;
    }
    await authorize(
      this.deps,
      actor,
      canRevokeGuardianship(actor, { learnerId: link.learnerId, existsInSpace: true }),
      "identity.revoke-guardianship",
      guardianshipId,
    );
    // La réauthentification vient après la politique : un acteur non autorisé reçoit 404, pas « réauthentifiez-vous ».
    requireRecentAuthentication(actor, now);
    await this.deps.gateway.inSpace(actor.tutorSpaceId, async (store) => {
      const links = await store.guardianshipsOfLearner(link.learnerId);
      const current = links.find((candidate) => candidate.id === guardianshipId);
      if (current === undefined) throw new NotFoundError();
      const revoked = revoke(current, links, now);
      await store.revokeGuardianship(revoked);
      await store.revokeSessionsOf(revoked.guardianId, now);
      await store.audit(
        auditEntry(
          this.deps,
          actor.tutorSpaceId,
          auditActorOf(actor),
          "identity.guardianship-revoked",
          "success",
          {
            targetId: guardianshipId,
          },
        ),
      );
    });
  }

  /** Profil d'un élève : le tuteur, ses parents liés, lui-même ; tout autre acteur : introuvable (R2). */
  async learner(actor: Actor, learnerId: LearnerId): Promise<LearnerView> {
    await authorize(
      this.deps,
      actor,
      canViewLearner(actor, await this.#target(actor, learnerId)),
      "identity.view-learner",
      learnerId,
    );
    return this.deps.gateway.inSpace(actor.tutorSpaceId, async (store) => {
      const view = (await this.#learnerViews(store)).find((candidate) => candidate.id === learnerId);
      if (view === undefined) throw new NotFoundError();
      return view;
    });
  }

  /** Les enfants du parent connecté ; pour le tuteur, tous les élèves de l'espace. */
  async myLearners(actor: Actor): Promise<LearnerView[]> {
    return this.deps.gateway.inSpace(actor.tutorSpaceId, async (store) => {
      const views = await this.#learnerViews(store);
      switch (actor.kind) {
        case "tutor":
          return views;
        case "guardian":
          return views.filter((view) => actor.learnerIds.has(view.id));
        case "learner":
          return views.filter((view) => view.id === actor.id);
      }
    });
  }

  /** Vue d'ensemble des familles pour le tuteur : parents, élèves et liens (le tuteur voit tous les liens, H1). */
  async families(actor: Actor): Promise<FamiliesView> {
    await authorize(this.deps, actor, canListFamilies(actor), "identity.list-families");
    return this.deps.gateway.inSpace(actor.tutorSpaceId, async (store) => {
      const accounts = await store.listAccounts();
      return {
        guardians: accounts
          .filter((account): account is GuardianAccount => account.role === "guardian")
          .map((guardian) => ({ id: guardian.id, displayName: guardian.displayName, email: guardian.email })),
        learners: await this.#learnerViews(store),
      };
    });
  }

  async #learnerViews(store: IdentityStore): Promise<LearnerView[]> {
    const accounts = await store.listAccounts();
    const links = (await store.allGuardianships()).filter(isActive);
    const names = new Map(
      accounts
        .filter((account) => account.role === "guardian")
        .map((guardian) => [guardian.id, guardian.displayName]),
    );
    return accounts
      .filter((account): account is LearnerAccount => account.role === "learner")
      .map((learner) => ({
        id: learner.id,
        firstName: learner.firstName,
        username: learner.username,
        schoolLevel: learner.schoolLevel,
        status: learner.status,
        scheduledDeletionAt: learner.scheduledDeletionAt,
        guardians: links
          .filter((link) => link.learnerId === learner.id)
          .map((link) => ({
            guardianshipId: link.id,
            guardianId: link.guardianId,
            displayName: names.get(link.guardianId) ?? "",
          })),
      }));
  }

  async #guardianFor(
    store: IdentityStore,
    email: EmailAddress,
    input: { password: string; displayName?: string },
    spaceId: GuardianAccount["tutorSpaceId"],
  ): Promise<GuardianAccount> {
    const existing = await store.adultByEmail(email);
    if (existing !== null) {
      // Compte existant : il prouve qu'il est bien le sien par son mot de passe.
      const valid = await this.deps.hasher.verify(existing.passwordHash, input.password);
      if (!valid || existing.role !== "guardian" || existing.status !== "active")
        throw new InvalidCredentialsError();
      return existing;
    }
    const displayName = DisplayName(input.displayName);
    checkPassword(input.password, "adult", this.deps.commonPasswords, [email]);
    const guardian: GuardianAccount = {
      role: "guardian",
      id: this.deps.ids.next("GuardianId"),
      tutorSpaceId: spaceId,
      status: "active",
      passwordHash: await this.deps.hasher.hash(input.password),
      createdAt: this.deps.clock.now(),
      email,
      displayName,
      mfa: { status: "none" },
    };
    await store.insertAccount(guardian);
    return guardian;
  }

  async #link(
    store: IdentityStore,
    guardian: GuardianAccount,
    learnerId: LearnerId,
    origin: "learner_creation" | "co_guardian_invitation",
  ): Promise<void> {
    const id = this.deps.ids.next("GuardianshipId");
    await store.insertGuardianship({
      id,
      tutorSpaceId: guardian.tutorSpaceId,
      guardianId: guardian.id,
      learnerId,
      origin,
      establishedAt: this.deps.clock.now(),
      revokedAt: null,
    });
    await store.audit(
      auditEntry(
        this.deps,
        guardian.tutorSpaceId,
        { kind: "guardian", id: guardian.id },
        "identity.guardianship-established",
        "success",
        {
          targetId: id,
        },
      ),
    );
  }

  async #recordConsent(
    store: IdentityStore,
    guardian: GuardianAccount,
    learnerId: LearnerId | null,
    consent: ConsentText,
  ): Promise<void> {
    const id = this.deps.ids.next("ParentalConsentId");
    await store.insertConsent({
      id,
      tutorSpaceId: guardian.tutorSpaceId,
      guardianId: guardian.id,
      learnerId,
      textVersion: consent.version,
      textSha256: consent.sha256,
      givenAt: this.deps.clock.now(),
      withdrawnAt: null,
    });
    await store.audit(
      auditEntry(
        this.deps,
        guardian.tutorSpaceId,
        { kind: "guardian", id: guardian.id },
        "identity.consent-given",
        "success",
        {
          targetId: id,
        },
      ),
    );
  }
}
