import type { Actor } from "../../identity/index.js";
import { NotFoundError } from "../../shared-kernel/DomainError.js";
import type { CompetencyDomainId, CompetencyId, TutorSpaceId } from "../../shared-kernel/ids.js";
import { CurriculumConflictError } from "../domain/errors.js";
import { nextCompetencyCode, type ReferentialSeedSubject } from "../domain/referential.js";
import { CompetencyLabel, Position } from "../domain/values.js";
import { canAuthor } from "./policies.js";
import type { CompetencyRecord, DomainRecord, SubjectRecord } from "./ports.js";
import { auditOf, authorize, type CurriculumDependencies } from "./support.js";

export interface ReferentialTree {
  readonly subjects: readonly SubjectRecord[];
  readonly domains: readonly DomainRecord[];
  readonly competencies: readonly CompetencyRecord[];
}

/**
 * Référentiel de compétences, géré par le tuteur dans l'application (jalons L2) : ajouter, renommer,
 * réordonner, archiver. Le code ne change jamais ; une compétence n'est jamais supprimée (la base
 * le refuse aussi), pour que l'historique des élèves reste lisible. Chaque modification est auditée (R12).
 */
export class ReferentialService {
  constructor(private readonly deps: CurriculumDependencies) {}

  /** Tout le référentiel, compétences archivées comprises (historique). */
  async tree(actor: Actor): Promise<ReferentialTree> {
    await authorize(this.deps, actor, canAuthor(actor), "curriculum.read-referential");
    return this.deps.gateway.inSpace(actor.tutorSpaceId, async (store) => ({
      subjects: await store.subjects(),
      domains: await store.domains(),
      competencies: await store.competencies(),
    }));
  }

  /** Les compétences proposées au choix (épreuves, L3) : les archivées en disparaissent. */
  async choices(actor: Actor): Promise<CompetencyRecord[]> {
    const tree = await this.tree(actor);
    return tree.competencies.filter((competency) => competency.archivedAt === null);
  }

  async add(actor: Actor, domainId: CompetencyDomainId, rawLabel: unknown): Promise<CompetencyRecord> {
    await authorize(this.deps, actor, canAuthor(actor), "curriculum.add-competency");
    const label = CompetencyLabel(rawLabel);
    return this.deps.gateway.inSpace(actor.tutorSpaceId, async (store) => {
      const domain = (await store.domains()).find((candidate) => candidate.id === domainId);
      if (domain === undefined) throw new NotFoundError();
      const all = await store.competencies();
      const competency: CompetencyRecord = {
        id: this.deps.ids.next("CompetencyId"),
        domainId,
        code: nextCompetencyCode(
          domain.prefix,
          all.map((candidate) => candidate.code),
        ),
        label,
        position: all.filter((candidate) => candidate.domainId === domainId).length,
        archivedAt: null,
      };
      await store.insertCompetency(competency, this.deps.clock.now());
      await store.audit(
        auditOf(this.deps, actor, "curriculum.competency-added", "success", { targetId: competency.id }),
      );
      return competency;
    });
  }

  /** Renommer ou réordonner ; le code reste le même. */
  async update(
    actor: Actor,
    id: CompetencyId,
    changes: { label?: unknown; position?: unknown },
  ): Promise<void> {
    await authorize(this.deps, actor, canAuthor(actor), "curriculum.update-competency", id);
    const label = changes.label === undefined ? undefined : CompetencyLabel(changes.label);
    const position = changes.position === undefined ? undefined : Position(changes.position);
    await this.deps.gateway.inSpace(actor.tutorSpaceId, async (store) => {
      const current = (await store.competencies()).find((candidate) => candidate.id === id);
      if (current === undefined) throw new NotFoundError();
      if (current.archivedAt !== null) throw new CurriculumConflictError("curriculum.competency-archived");
      await store.updateCompetency({
        ...current,
        ...(label === undefined ? {} : { label }),
        ...(position === undefined ? {} : { position }),
      });
      await store.audit(
        auditOf(
          this.deps,
          actor,
          label === undefined ? "curriculum.competency-reordered" : "curriculum.competency-renamed",
          "success",
          {
            targetId: id,
          },
        ),
      );
    });
  }

  /** Archiver : la compétence disparaît des choix, son historique reste lisible. */
  async archive(actor: Actor, id: CompetencyId): Promise<void> {
    await authorize(this.deps, actor, canAuthor(actor), "curriculum.archive-competency", id);
    await this.deps.gateway.inSpace(actor.tutorSpaceId, async (store) => {
      const current = (await store.competencies()).find((candidate) => candidate.id === id);
      if (current === undefined) throw new NotFoundError();
      if (current.archivedAt !== null) return;
      await store.updateCompetency({ ...current, archivedAt: this.deps.clock.now() });
      await store.audit(
        auditOf(this.deps, actor, "curriculum.competency-archived", "success", { targetId: id }),
      );
    });
  }

  /**
   * Seed du référentiel validé (docs/domaine/referentiel-competences.md), idempotent : ce qui existe
   * déjà (même code, même matière) n'est jamais modifié — le tuteur a pu renommer ou archiver.
   */
  async seed(
    tutorSpaceId: TutorSpaceId,
    subjects: readonly ReferentialSeedSubject[],
  ): Promise<{ added: number }> {
    const now = this.deps.clock.now();
    return this.deps.gateway.inSpace(tutorSpaceId, async (store) => {
      let added = 0;
      const existingSubjects = await store.subjects();
      const existingDomains = await store.domains();
      const existingCodes = new Set((await store.competencies()).map((competency) => competency.code));
      for (const [subjectIndex, seedSubject] of subjects.entries()) {
        let subject = existingSubjects.find((candidate) => candidate.name === seedSubject.name);
        if (subject === undefined) {
          subject = { id: this.deps.ids.next("SubjectId"), name: seedSubject.name, position: subjectIndex };
          await store.insertSubject(subject, now);
        }
        for (const [domainIndex, seedDomain] of seedSubject.domains.entries()) {
          let domain = existingDomains.find((candidate) => candidate.prefix === seedDomain.prefix);
          if (domain === undefined) {
            domain = {
              id: this.deps.ids.next("CompetencyDomainId"),
              subjectId: subject.id,
              prefix: seedDomain.prefix,
              label: seedDomain.label,
              position: domainIndex,
            };
            await store.insertDomain(domain);
          }
          for (const [position, seedCompetency] of seedDomain.competencies.entries()) {
            if (existingCodes.has(seedCompetency.code)) continue;
            await store.insertCompetency(
              {
                id: this.deps.ids.next("CompetencyId"),
                domainId: domain.id,
                code: seedCompetency.code,
                label: CompetencyLabel(seedCompetency.label),
                position,
                archivedAt: null,
              },
              now,
            );
            added++;
          }
        }
      }
      return { added };
    });
  }
}
