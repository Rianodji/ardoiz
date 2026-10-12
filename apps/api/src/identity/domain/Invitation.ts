import { NotFoundError } from "../../shared-kernel/DomainError.js";
import type { GuardianId, InvitationId, LearnerId, TutorId, TutorSpaceId } from "../../shared-kernel/ids.js";
import type { EmailAddress } from "./values.js";

/** Durée de validité d'une invitation (R1) : 72 heures, pas une seconde de plus. */
export const INVITATION_LIFETIME_MS = 72 * 60 * 60 * 1000;

export type InvitationKind = "guardian" | "co_guardian";

export interface InvitationState {
  readonly id: InvitationId;
  readonly tutorSpaceId: TutorSpaceId;
  readonly kind: InvitationKind;
  readonly email: EmailAddress;
  /** Empreinte SHA-256 du jeton : le jeton lui-même n'est jamais stocké (R1). */
  readonly tokenHash: string;
  readonly invitedBy: TutorId | GuardianId;
  /** Élève concerné, pour une invitation de co-parent uniquement. */
  readonly learnerId: LearnerId | null;
  readonly createdAt: Date;
  readonly expiresAt: Date;
  readonly consumedAt: Date | null;
}

export type IssueInvitation =
  | {
      readonly kind: "guardian";
      readonly invitedBy: TutorId;
      readonly learnerId?: undefined;
    }
  | {
      readonly kind: "co_guardian";
      readonly invitedBy: GuardianId;
      readonly learnerId: LearnerId;
    };

/** Invitation à usage unique et de durée limitée (R1, M1). */
export class Invitation {
  private constructor(private state: InvitationState) {}

  static issue(
    base: Pick<InvitationState, "id" | "tutorSpaceId" | "email" | "tokenHash">,
    who: IssueInvitation,
    now: Date,
  ): Invitation {
    return new Invitation({
      ...base,
      kind: who.kind,
      invitedBy: who.invitedBy,
      learnerId: who.kind === "co_guardian" ? who.learnerId : null,
      createdAt: now,
      expiresAt: new Date(now.getTime() + INVITATION_LIFETIME_MS),
      consumedAt: null,
    });
  }

  static restore(state: InvitationState): Invitation {
    return new Invitation(state);
  }

  get snapshot(): InvitationState {
    return this.state;
  }

  /**
   * Un jeton consommé ou expiré est refusé exactement comme un jeton inexistant (R1, feature
   * lien-parental) : l'appelant n'apprend rien sur l'existence de l'invitation.
   */
  assertUsable(now: Date): void {
    if (this.state.consumedAt !== null || now.getTime() >= this.state.expiresAt.getTime()) {
      throw new NotFoundError();
    }
  }

  /** Consommation unique : une seconde acceptation échoue (R1). */
  consume(now: Date): void {
    this.assertUsable(now);
    this.state = { ...this.state, consumedAt: now };
  }
}
