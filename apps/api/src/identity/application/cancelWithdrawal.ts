import { DomainError } from "../../shared-kernel/DomainError.js";
import type { LearnerId, TutorSpaceId } from "../../shared-kernel/ids.js";
import { LearnerId as parseLearnerId } from "../../shared-kernel/ids.js";
import { EmailAddress, SpaceCode } from "../domain/values.js";
import { auditEntry, type IdentityDependencies } from "./support.js";

/** Annulation impossible : élève inconnu, actif, déjà purgé, ou parent qui ne lui est pas lié. */
export class WithdrawalNotCancellableError extends DomainError {
  readonly code = "identity.withdrawal-not-cancellable";

  constructor() {
    super("Ce retrait ne peut pas être annulé.");
  }
}

export interface CancelWithdrawalInput {
  readonly spaceCode: string;
  readonly learnerId: string;
  /** Adresse du parent lié qui a demandé l'annulation PAR ÉCRIT (runbook §6). */
  readonly guardianEmail: string;
}

/**
 * Annulation d'un retrait de consentement (verdict L7, S-1), depuis la CLI d'exploitation, à la demande
 * écrite d'un parent lié, avant la purge. Le retrait reste dans l'historique : un NOUVEAU consentement
 * est enregistré au nom de ce parent, pour le texte en vigueur. Le compte est réactivé et la suppression
 * planifiée est levée ; l'audit en garde la trace.
 */
export async function cancelWithdrawal(
  deps: IdentityDependencies,
  input: CancelWithdrawalInput,
): Promise<{ tutorSpaceId: TutorSpaceId; learnerId: LearnerId }> {
  const tutorSpaceId = await deps.gateway.spaceByCode(SpaceCode(input.spaceCode));
  const email = EmailAddress(input.guardianEmail);
  const learnerId = parseLearnerId(input.learnerId);
  if (tutorSpaceId === null) throw new WithdrawalNotCancellableError();
  const now = deps.clock.now();
  const text = deps.consentTexts.current();
  await deps.gateway.inSpace(tutorSpaceId, async (store) => {
    const learner = await store.accountById(learnerId);
    // Lu sous la RLS de l'espace : un parent d'un autre espace n'existe pas ici.
    const parent = await store.adultByEmail(email);
    const linked =
      parent !== null &&
      (await store.guardianshipsOfLearner(learnerId)).some(
        (link) => link.revokedAt === null && link.guardianId === parent.id,
      );
    // Après la purge, les liens parentaux n'existent plus : l'annulation est alors impossible.
    if (
      learner === null ||
      learner.role !== "learner" ||
      learner.status !== "disabled" ||
      learner.scheduledDeletionAt === null ||
      parent === null ||
      parent.role !== "guardian" ||
      !linked
    ) {
      throw new WithdrawalNotCancellableError();
    }
    await store.insertConsent({
      id: deps.ids.next("ParentalConsentId"),
      tutorSpaceId,
      guardianId: parent.id,
      learnerId,
      textVersion: text.version,
      textSha256: text.sha256,
      givenAt: now,
      withdrawnAt: null,
    });
    await store.updateAccount({ ...learner, status: "active", scheduledDeletionAt: null });
    await store.audit(
      auditEntry(deps, tutorSpaceId, { kind: "system" }, "identity.withdrawal-cancelled", "success", {
        targetId: learnerId,
      }),
    );
  });
  return { tutorSpaceId, learnerId };
}
