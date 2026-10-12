import type { Actor } from "../../identity/index.js";
import { NotFoundError } from "../../shared-kernel/DomainError.js";
import type { GroupId, LearnerId, UnlockId } from "../../shared-kernel/ids.js";
import type { UnlockAudience, UnlockTarget } from "../domain/access.js";
import { CurriculumConflictError } from "../domain/errors.js";
import { GroupName } from "../domain/values.js";
import { canAuthor } from "./policies.js";
import type { GroupRecord, UnlockRecord } from "./ports.js";
import { auditOf, authorize, type CurriculumDependencies } from "./support.js";

/** Groupes d'élèves et déverrouillages (R3) : le tuteur seul ; chaque (dé)verrouillage est audité (R12). */
export class AudienceService {
  constructor(private readonly deps: CurriculumDependencies) {}

  async groups(actor: Actor): Promise<GroupRecord[]> {
    await authorize(this.deps, actor, canAuthor(actor), "curriculum.read-groups");
    return this.deps.gateway.inSpace(actor.tutorSpaceId, (store) => store.groups());
  }

  async createGroup(actor: Actor, rawName: unknown): Promise<GroupRecord> {
    await authorize(this.deps, actor, canAuthor(actor), "curriculum.create-group");
    const name = GroupName(rawName);
    return this.deps.gateway.inSpace(actor.tutorSpaceId, async (store) => {
      if ((await store.groups()).some((group) => group.name === name))
        throw new CurriculumConflictError("curriculum.name-taken");
      const group: GroupRecord = { id: this.deps.ids.next("GroupId"), name, learnerIds: [] };
      await store.insertGroup(group, this.deps.clock.now());
      return group;
    });
  }

  /** Remplace les membres ; un élève inconnu dans l'espace est refusé par la base (clé étrangère, R10). */
  async setMembers(actor: Actor, groupId: GroupId, learnerIds: readonly LearnerId[]): Promise<void> {
    await authorize(this.deps, actor, canAuthor(actor), "curriculum.set-group-members", groupId);
    await this.deps.gateway.inSpace(actor.tutorSpaceId, async (store) => {
      if (!(await store.groups()).some((group) => group.id === groupId)) throw new NotFoundError();
      await store.setGroupMembers(groupId, [...new Set(learnerIds)]);
      await store.audit(
        auditOf(this.deps, actor, "curriculum.group-members-set", "success", { targetId: groupId }),
      );
    });
  }

  async unlocks(actor: Actor): Promise<UnlockRecord[]> {
    await authorize(this.deps, actor, canAuthor(actor), "curriculum.read-unlocks");
    return this.deps.gateway.inSpace(actor.tutorSpaceId, (store) => store.activeUnlocks());
  }

  async unlock(actor: Actor, target: UnlockTarget, audience: UnlockAudience): Promise<UnlockRecord> {
    await authorize(this.deps, actor, canAuthor(actor), "curriculum.unlock");
    if (actor.kind !== "tutor") throw new NotFoundError();
    const tutorId = actor.id;
    return this.deps.gateway.inSpace(actor.tutorSpaceId, async (store) => {
      const exists =
        target.kind === "module"
          ? (await store.modules()).some((module) => module.id === target.id)
          : (await store.lessonById(target.id)) !== null;
      if (!exists) throw new NotFoundError();
      if (audience.kind === "group" && !(await store.groups()).some((group) => group.id === audience.id))
        throw new NotFoundError();
      const active = await store.activeUnlocks();
      if (active.some((unlock) => unlock.target.id === target.id && unlock.audience.id === audience.id)) {
        throw new CurriculumConflictError("curriculum.already-unlocked");
      }
      const unlock: UnlockRecord = {
        id: this.deps.ids.next("UnlockId"),
        target,
        audience,
        unlockedAt: this.deps.clock.now(),
        unlockedBy: tutorId,
        relockedAt: null,
      };
      await store.insertUnlock(unlock);
      await store.audit(auditOf(this.deps, actor, "curriculum.unlocked", "success", { targetId: unlock.id }));
      return unlock;
    });
  }

  /** Reverrouiller : l'accès cesse immédiatement ; l'historique du déverrouillage est conservé. */
  async relock(actor: Actor, id: UnlockId): Promise<void> {
    await authorize(this.deps, actor, canAuthor(actor), "curriculum.relock", id);
    await this.deps.gateway.inSpace(actor.tutorSpaceId, async (store) => {
      const unlock = await store.unlockById(id);
      if (unlock === null || unlock.relockedAt !== null) throw new NotFoundError();
      await store.relock(id, this.deps.clock.now());
      await store.audit(auditOf(this.deps, actor, "curriculum.relocked", "success", { targetId: id }));
    });
  }
}
