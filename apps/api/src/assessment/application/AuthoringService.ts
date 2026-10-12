import type { Actor } from "../../identity/index.js";
import { NotFoundError } from "../../shared-kernel/DomainError.js";
import {
  CompetencyId,
  type AssessmentId,
  type GroupId,
  type LearnerId,
  type SubjectId,
} from "../../shared-kernel/ids.js";
import { AttemptRefusedError, InvalidAssessmentInput } from "../domain/errors.js";
import { halfPoints, parseSpec, plainText, type Question, type QuestionKind } from "../domain/questions.js";
import { assessmentForAuthor } from "./projections.js";
import { canAuthorOrGrade } from "./policies.js";
import type { AssessmentRecord, AssignmentRecord } from "./ports.js";
import { auditOf, authorize, type AssessmentDependencies } from "./support.js";

export interface QuestionInput {
  readonly kind: QuestionKind;
  readonly prompt: unknown;
  readonly points: unknown;
  readonly competencyIds: readonly unknown[];
  readonly explanation?: unknown;
  readonly [key: string]: unknown;
}

export interface AssignmentInput {
  readonly assessmentId: AssessmentId;
  readonly audience:
    { readonly kind: "learner"; readonly id: LearnerId } | { readonly kind: "group"; readonly id: GroupId };
  readonly opensAt: Date;
  readonly dueAt: Date;
  readonly maxAttempts: number;
  readonly lateAllowed: boolean;
  readonly publication: "auto" | "manual";
}

function parsedCompetency(raw: string): CompetencyId | null {
  try {
    return CompetencyId(raw);
  } catch {
    return null; // un identifiant mal formé est une compétence inconnue : refus ci-dessus
  }
}

/** Bornes d'une épreuve (R15). */
const MAX_QUESTIONS = 50;

/**
 * Création des épreuves et attributions, par le tuteur seul. Une épreuve attribuée n'est plus
 * modifiable : les copies rendues doivent toujours correspondre aux questions posées (R6).
 */
export class AuthoringService {
  constructor(private readonly deps: AssessmentDependencies) {}

  async create(actor: Actor, subjectId: SubjectId, rawTitle: unknown): Promise<AssessmentRecord> {
    await authorize(this.deps, actor, canAuthorOrGrade(actor), "assessment.create");
    const title = plainText(rawTitle, 120, "assessment.invalid-title");
    if (!(await this.deps.curriculum.subjectExists(actor.tutorSpaceId, subjectId))) throw new NotFoundError();
    const now = this.deps.clock.now();
    const assessment: AssessmentRecord = {
      id: this.deps.ids.next("AssessmentId"),
      subjectId,
      title,
      questions: [],
      createdAt: now,
      updatedAt: now,
    };
    await this.deps.gateway.inSpace(actor.tutorSpaceId, (store) => store.insertAssessment(assessment));
    return assessment;
  }

  async list(actor: Actor) {
    await authorize(this.deps, actor, canAuthorOrGrade(actor), "assessment.list");
    return this.deps.gateway.inSpace(actor.tutorSpaceId, async (store) => {
      const assessments = await store.assessments();
      // Une transaction = un client : les requêtes s'enchaînent, jamais en parallèle.
      const views = [];
      for (const assessment of assessments)
        views.push(assessmentForAuthor(assessment, await store.isAssigned(assessment.id)));
      return views;
    });
  }

  async get(actor: Actor, id: AssessmentId) {
    await authorize(this.deps, actor, canAuthorOrGrade(actor), "assessment.read", id);
    return this.deps.gateway.inSpace(actor.tutorSpaceId, async (store) => {
      const assessment = await store.assessmentById(id);
      if (assessment === null) throw new NotFoundError();
      return assessmentForAuthor(assessment, await store.isAssigned(id));
    });
  }

  /** Remplace les questions ; chacune évalue au moins une compétence proposée au choix (non archivée). */
  async replaceQuestions(actor: Actor, id: AssessmentId, inputs: readonly QuestionInput[]): Promise<void> {
    await authorize(this.deps, actor, canAuthorOrGrade(actor), "assessment.edit", id);
    if (inputs.length > MAX_QUESTIONS) throw new InvalidAssessmentInput("assessment.invalid-questions");
    const active = await this.deps.curriculum.activeCompetencyIds(actor.tutorSpaceId);
    const questions: Question[] = inputs.map((input, position) => {
      const competencyIds = [...new Set(input.competencyIds)].map((raw) => {
        const id = typeof raw === "string" ? parsedCompetency(raw) : null;
        if (id === null || !active.has(id))
          throw new InvalidAssessmentInput("assessment.invalid-competencies");
        return id;
      });
      if (competencyIds.length === 0) throw new InvalidAssessmentInput("assessment.invalid-competencies");
      return {
        id: this.deps.ids.next("QuestionId"),
        position,
        prompt: plainText(input.prompt, 2000, "assessment.invalid-prompt"),
        points: halfPoints(input.points, 0.5, 100),
        competencyIds,
        explanation:
          input.explanation === undefined || input.explanation === null || input.explanation === ""
            ? null
            : plainText(input.explanation, 2000, "assessment.invalid-explanation"),
        spec: parseSpec(input),
      };
    });
    await this.deps.gateway.inSpace(actor.tutorSpaceId, async (store) => {
      if ((await store.assessmentById(id)) === null) throw new NotFoundError();
      if (await store.isAssigned(id)) throw new AttemptRefusedError("assessment.locked");
      await store.replaceQuestions(id, questions, this.deps.clock.now());
    });
  }

  /** Attribue une épreuve à un élève ou à un groupe ; le groupe est résolu en élèves à cet instant. */
  async assign(actor: Actor, input: AssignmentInput): Promise<AssignmentRecord> {
    await authorize(this.deps, actor, canAuthorOrGrade(actor), "assessment.assign");
    if (actor.kind !== "tutor") throw new NotFoundError();
    const tutorId = actor.id;
    if (input.dueAt.getTime() <= input.opensAt.getTime())
      throw new InvalidAssessmentInput("assessment.invalid-window");
    if (!Number.isInteger(input.maxAttempts) || input.maxAttempts < 1 || input.maxAttempts > 10) {
      throw new InvalidAssessmentInput("assessment.invalid-max-attempts");
    }
    const learnerIds =
      input.audience.kind === "learner"
        ? [input.audience.id]
        : await this.deps.curriculum.learnersOfGroup(actor.tutorSpaceId, input.audience.id);
    if (learnerIds === null) throw new NotFoundError();
    if (learnerIds.length === 0) throw new InvalidAssessmentInput("assessment.invalid-audience");
    // Un identifiant qui n'est pas un élève de l'espace (autre espace, adulte) : 404 (R2).
    const existing = await this.deps.learners.existingLearners(actor.tutorSpaceId, learnerIds);
    if (existing.length !== new Set(learnerIds).size) throw new NotFoundError();
    return this.deps.gateway.inSpace(actor.tutorSpaceId, async (store) => {
      const assessment = await store.assessmentById(input.assessmentId);
      if (assessment === null) throw new NotFoundError();
      if (assessment.questions.length === 0) throw new InvalidAssessmentInput("assessment.invalid-questions");
      const assignment: AssignmentRecord = {
        id: this.deps.ids.next("AssignmentId"),
        assessmentId: input.assessmentId,
        opensAt: input.opensAt,
        dueAt: input.dueAt,
        maxAttempts: input.maxAttempts,
        lateAllowed: input.lateAllowed,
        publication: input.publication,
        learnerIds,
        createdAt: this.deps.clock.now(),
        createdBy: tutorId,
      };
      await store.insertAssignment(assignment);
      await store.audit(
        auditOf(this.deps, actor, "assessment.assigned", "success", { targetId: assignment.id }),
      );
      return assignment;
    });
  }

  async assignments(actor: Actor): Promise<AssignmentRecord[]> {
    await authorize(this.deps, actor, canAuthorOrGrade(actor), "assessment.list-assignments");
    return this.deps.gateway.inSpace(actor.tutorSpaceId, (store) => store.assignments());
  }
}
