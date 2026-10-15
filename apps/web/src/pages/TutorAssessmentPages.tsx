import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useId, useState, type ReactNode } from "react";
import { Link, useParams } from "react-router";
import { Button, ButtonLink, Card, Field, Notice, PageHeader, Pill } from "../ui";
import { longDateTime, numberFr, plural, shortDateTime } from "../ui/format";
import { Check, ClipboardList, Minus, Pencil, Plus } from "../ui/icons";
import {
  assignAssessment,
  createAssessment,
  fetchAssessments,
  fetchAssignments,
  fetchGradingQueue,
  fetchTutorAttempt,
  gradeAttempt,
  publishAttempt,
  rectifyGrade,
  revealAnswers,
  saveAnnotation,
  saveQuestions,
  type AuthorAssessment,
  type QuestionInput,
  type TutorAttempt,
} from "../api/assessment";
import { fetchCompetencyChoices, fetchGroups, fetchProgramme } from "../api/curriculum";
import { fetchFamilies } from "../api/identity";
import { ErrorMessage } from "../components/ErrorMessage";
import { formulasOf, NotebookField } from "../notebook/NotebookField";

/** Unités proposées pour une question numérique : le serveur valide contre le même catalogue fermé. */
const UNIT_CHOICES = [
  "mm",
  "cm",
  "dm",
  "m",
  "dam",
  "hm",
  "km",
  "mg",
  "cg",
  "dg",
  "g",
  "dag",
  "hg",
  "kg",
  "t",
  "mL",
  "cL",
  "dL",
  "L",
  "daL",
  "hL",
  "mm²",
  "cm²",
  "dm²",
  "m²",
  "dam²",
  "hm²",
  "km²",
  "mm³",
  "cm³",
  "dm³",
  "m³",
  "s",
  "min",
  "h",
  "j",
] as const;

const KIND_LABELS = {
  mcq: "QCM",
  numeric: "Numérique",
  short_text: "Réponse courte",
  notebook: "Cahier",
} as const;
const ASSESSMENTS = ["assessments"] as const;

/** Question en cours d'écriture : champs texte du formulaire, convertis à l'enregistrement. */
interface QuestionDraft {
  kind: QuestionInput["kind"];
  prompt: string;
  points: string;
  competencyId: string;
  explanation: string;
  options: string;
  correctOptions: string;
  expected: string;
  tolerance: string;
  unit: string;
  unitMode: "imposed" | "free";
  modelAnswer: string;
}

const blankQuestion = (competencyId: string): QuestionDraft => ({
  kind: "mcq",
  prompt: "",
  points: "1",
  competencyId,
  explanation: "",
  options: "",
  correctOptions: "1",
  expected: "",
  tolerance: "0",
  unit: "cm",
  unitMode: "free",
  modelAnswer: "",
});

function toInput(draft: QuestionDraft): QuestionInput {
  const base = {
    prompt: draft.prompt,
    points: Number(draft.points.replace(",", ".")),
    competencyIds: [draft.competencyId],
    ...(draft.explanation.trim() === "" ? {} : { explanation: draft.explanation }),
  };
  switch (draft.kind) {
    case "mcq":
      return {
        kind: "mcq",
        ...base,
        options: draft.options
          .split("\n")
          .map((text) => text.trim())
          .filter((text) => text !== "")
          .map((text) => ({ text })),
        // Saisies « 1, 3 » : numéros des bonnes options, à partir de 1.
        correctOptions: draft.correctOptions
          .split(/[,\s]+/)
          .filter((n) => n !== "")
          .map((n) => Number(n) - 1),
      };
    case "numeric":
      return {
        kind: "numeric",
        ...base,
        expected: draft.expected,
        tolerance: draft.tolerance,
        unit: draft.unit,
        unitMode: draft.unitMode,
      };
    case "short_text":
    case "notebook":
      return {
        kind: draft.kind,
        ...base,
        ...(draft.modelAnswer.trim() === "" ? {} : { modelAnswer: draft.modelAnswer }),
      };
  }
}

function QuestionEditor({ assessment }: { readonly assessment: AuthorAssessment }) {
  const queryClient = useQueryClient();
  const competencies = useQuery({ queryKey: ["competency-choices"], queryFn: fetchCompetencyChoices });
  const [draft, setDraft] = useState<QuestionDraft | null>(null);
  const id = useId();
  const save = useMutation({
    mutationFn: (question: QuestionInput) =>
      saveQuestions(assessment.id, [
        ...assessment.questions.map((existing): QuestionInput => {
          const base = {
            prompt: existing.prompt,
            points: existing.points,
            competencyIds: existing.competencyIds,
            ...(existing.explanation === null ? {} : { explanation: existing.explanation }),
          };
          const spec = existing.spec;
          switch (spec.kind) {
            case "mcq":
              return {
                kind: "mcq",
                ...base,
                options: spec.options.map((option) => ({ text: option.text })),
                correctOptions: spec.correctOptionIds.map((optionId) =>
                  spec.options.findIndex((option) => option.id === optionId),
                ),
              };
            case "numeric":
              return {
                kind: "numeric",
                ...base,
                expected: spec.expected,
                tolerance: spec.tolerance,
                unit: spec.unit,
                unitMode: spec.unitMode,
              };
            case "short_text":
            case "notebook":
              return {
                kind: spec.kind,
                ...base,
                ...(spec.modelAnswer === null ? {} : { modelAnswer: spec.modelAnswer }),
              };
          }
        }),
        question,
      ]),
    onSuccess: async () => {
      setDraft(null);
      await queryClient.invalidateQueries({ queryKey: ASSESSMENTS });
    },
  });
  const choices = competencies.data?.competencies ?? [];
  if (draft === null)
    return (
      <Button
        variant="secondary"
        icon={Plus}
        onClick={() => {
          setDraft(blankQuestion(choices[0]?.id ?? ""));
        }}
      >
        Ajouter une question
      </Button>
    );
  const set = (changes: Partial<QuestionDraft>) => {
    setDraft({ ...draft, ...changes });
  };
  return (
    <form
      className="form-stack card dashed"
      aria-label="Nouvelle question"
      onSubmit={(event) => {
        event.preventDefault();
        save.mutate(toInput(draft));
      }}
    >
      <label htmlFor={`${id}-kind`}>Type</label>
      <select
        id={`${id}-kind`}
        value={draft.kind}
        onChange={(event) => {
          set({ kind: event.target.value as QuestionDraft["kind"] });
        }}
      >
        {Object.entries(KIND_LABELS).map(([kind, label]) => (
          <option key={kind} value={kind}>
            {label}
          </option>
        ))}
      </select>
      <label htmlFor={`${id}-prompt`}>Énoncé</label>
      <textarea
        id={`${id}-prompt`}
        maxLength={2000}
        required
        value={draft.prompt}
        onChange={(event) => {
          set({ prompt: event.target.value });
        }}
      />
      <label htmlFor={`${id}-points`}>Barème (points, par demi-point)</label>
      <input
        id={`${id}-points`}
        inputMode="decimal"
        value={draft.points}
        onChange={(event) => {
          set({ points: event.target.value });
        }}
      />
      <label htmlFor={`${id}-competency`}>Compétence évaluée</label>
      <select
        id={`${id}-competency`}
        value={draft.competencyId}
        onChange={(event) => {
          set({ competencyId: event.target.value });
        }}
      >
        {choices.map((competency) => (
          <option key={competency.id} value={competency.id}>
            {competency.code} — {competency.label}
          </option>
        ))}
      </select>
      {draft.kind === "mcq" && (
        <>
          <label htmlFor={`${id}-options`}>Options (une par ligne, 2 à 8)</label>
          <textarea
            id={`${id}-options`}
            rows={4}
            value={draft.options}
            onChange={(event) => {
              set({ options: event.target.value });
            }}
          />
          <label htmlFor={`${id}-correct`}>Numéros des bonnes options (ex. « 2 » ou « 1, 3 »)</label>
          <input
            id={`${id}-correct`}
            value={draft.correctOptions}
            onChange={(event) => {
              set({ correctOptions: event.target.value });
            }}
          />
        </>
      )}
      {draft.kind === "numeric" && (
        <>
          <label htmlFor={`${id}-expected`}>Réponse attendue</label>
          <input
            id={`${id}-expected`}
            inputMode="decimal"
            value={draft.expected}
            onChange={(event) => {
              set({ expected: event.target.value });
            }}
          />
          <label htmlFor={`${id}-tolerance`}>Tolérance (dans l'unité attendue)</label>
          <input
            id={`${id}-tolerance`}
            inputMode="decimal"
            value={draft.tolerance}
            onChange={(event) => {
              set({ tolerance: event.target.value });
            }}
          />
          <label htmlFor={`${id}-unit`}>Unité attendue</label>
          <select
            id={`${id}-unit`}
            value={draft.unit}
            onChange={(event) => {
              set({ unit: event.target.value });
            }}
          >
            {UNIT_CHOICES.map((unit) => (
              <option key={unit}>{unit}</option>
            ))}
          </select>
          <label htmlFor={`${id}-mode`}>Unité</label>
          <select
            id={`${id}-mode`}
            value={draft.unitMode}
            onChange={(event) => {
              set({ unitMode: event.target.value as "imposed" | "free" });
            }}
          >
            <option value="free">libre : une unité équivalente est convertie</option>
            <option value="imposed">imposée : une autre unité est fausse (exercice de conversion)</option>
          </select>
        </>
      )}
      {(draft.kind === "short_text" || draft.kind === "notebook") && (
        <>
          <label htmlFor={`${id}-model`}>Réponse modèle (montrée après publication)</label>
          <textarea
            id={`${id}-model`}
            maxLength={1000}
            value={draft.modelAnswer}
            onChange={(event) => {
              set({ modelAnswer: event.target.value });
            }}
          />
        </>
      )}
      <label htmlFor={`${id}-explanation`}>Corrigé (montré après publication)</label>
      <textarea
        id={`${id}-explanation`}
        maxLength={2000}
        value={draft.explanation}
        onChange={(event) => {
          set({ explanation: event.target.value });
        }}
      />
      <ErrorMessage error={save.error} />
      <div className="actions">
        <Button type="submit">Enregistrer la question</Button>
        <Button
          variant="quiet"
          onClick={() => {
            setDraft(null);
          }}
        >
          Annuler
        </Button>
      </div>
    </form>
  );
}

/** Valeur d'un champ datetime-local, en heure de l'appareil (le tuteur est à Paris). */
function localInput(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${String(date.getFullYear())}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/**
 * Attribution d'une épreuve (maquette Tuteur-Epreuves). L8, correction 2 : l'ouverture vaut
 * « Maintenant » par défaut ; une ouverture plus tard reste possible, et l'élève voit alors « S'ouvre le … ».
 */
function AssignForm({
  assessment,
  onDone,
}: {
  readonly assessment: AuthorAssessment;
  readonly onDone: () => void;
}) {
  const families = useQuery({ queryKey: ["families"], queryFn: fetchFamilies });
  const groups = useQuery({ queryKey: ["groups"], queryFn: fetchGroups });
  const queryClient = useQueryClient();
  const [audience, setAudience] = useState("");
  const [opening, setOpening] = useState<"now" | "later">("now");
  const [opensAt, setOpensAt] = useState("");
  const [dueAt, setDueAt] = useState("");
  const [maxAttempts, setMaxAttempts] = useState("1");
  const [lateAllowed, setLateAllowed] = useState(false);
  const [autoPublish, setAutoPublish] = useState(false);
  const assign = useMutation({
    mutationFn: () => {
      const [kind, targetId = ""] = audience.split(":");
      return assignAssessment({
        assessmentId: assessment.id,
        audience: { kind: kind === "group" ? "group" : "learner", id: targetId },
        // « Maintenant » : l'instant du clic. Le serveur accepte une ouverture passée (fenêtre inchangée).
        opensAt: (opening === "now" ? new Date() : new Date(opensAt)).toISOString(),
        dueAt: new Date(dueAt).toISOString(),
        maxAttempts: Number(maxAttempts),
        lateAllowed,
        publication: autoPublish ? "auto" : "manual",
      });
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ASSESSMENTS });
      await queryClient.invalidateQueries({ queryKey: ["assignments"] });
      onDone();
    },
  });
  const due = dueAt === "" ? null : new Date(dueAt);
  const opens = opening === "later" && opensAt !== "" ? new Date(opensAt) : null;
  return (
    <Card aria-labelledby={`attribuer-${assessment.id}`}>
      <div className="card-head">
        <h2 id={`attribuer-${assessment.id}`}>Attribuer « {assessment.title} »</h2>
        <p className="hint">Une fois attribuée, l'épreuve ne peut plus être modifiée.</p>
      </div>
      <form
        className="form-stack"
        onSubmit={(event) => {
          event.preventDefault();
          assign.mutate();
        }}
      >
        <div className="field-row">
          <Field label="Pour">
            {(control) => (
              <select
                {...control}
                required
                value={audience}
                onChange={(event) => {
                  setAudience(event.target.value);
                }}
              >
                <option value="">Choisir…</option>
                {(groups.data?.groups ?? []).map((group) => (
                  <option key={group.id} value={`group:${group.id}`}>
                    Groupe {group.name}
                    {group.learnerIds.length > 0
                      ? ` (${group.learnerIds
                          .map(
                            (id) =>
                              families.data?.learners.find((learner) => learner.id === id)?.firstName ?? "",
                          )
                          .filter((name) => name !== "")
                          .join(", ")})`
                      : ""}
                  </option>
                ))}
                {(families.data?.learners ?? []).map((learner) => (
                  <option key={learner.id} value={`learner:${learner.id}`}>
                    {learner.firstName}
                  </option>
                ))}
              </select>
            )}
          </Field>
          <Field label="S'ouvre">
            {(control) => (
              <select
                {...control}
                value={opening}
                onChange={(event) => {
                  setOpening(event.target.value === "later" ? "later" : "now");
                }}
              >
                <option value="now">Maintenant</option>
                <option value="later">À une date choisie</option>
              </select>
            )}
          </Field>
          {opening === "later" && (
            <Field label="Date d'ouverture">
              {(control) => (
                <input
                  {...control}
                  type="datetime-local"
                  required
                  min={localInput(new Date())}
                  value={opensAt}
                  onChange={(event) => {
                    setOpensAt(event.target.value);
                  }}
                />
              )}
            </Field>
          )}
          <Field label="À rendre avant">
            {(control) => (
              <input
                {...control}
                type="datetime-local"
                required
                value={dueAt}
                onChange={(event) => {
                  setDueAt(event.target.value);
                }}
              />
            )}
          </Field>
          <Field label="Tentatives">
            {(control) => (
              <select
                {...control}
                value={maxAttempts}
                onChange={(event) => {
                  setMaxAttempts(event.target.value);
                }}
              >
                {[1, 2, 3, 4, 5, 10].map((count) => (
                  <option key={count} value={String(count)}>
                    {count === 1 ? "1 seule" : String(count)}
                  </option>
                ))}
              </select>
            )}
          </Field>
        </div>
        <div className="actions">
          <label className="check-line">
            <input
              type="checkbox"
              checked={lateAllowed}
              onChange={(event) => {
                setLateAllowed(event.target.checked);
              }}
            />
            Accepter les copies en retard (marquées « en retard »)
          </label>
          <label className="check-line">
            <input
              type="checkbox"
              checked={autoPublish}
              onChange={(event) => {
                setAutoPublish(event.target.checked);
              }}
            />
            Publier la note dès que tout est corrigé automatiquement
          </label>
        </div>
        {due !== null && !Number.isNaN(due.getTime()) && (
          <Notice>
            <p>
              L'élève verra :{" "}
              {opens !== null && !Number.isNaN(opens.getTime())
                ? `« S'ouvre le ${longDateTime(opens)} », puis `
                : ""}
              « À rendre avant {longDateTime(due)} ». Le corrigé lui sera montré après cette date.
            </p>
          </Notice>
        )}
        <ErrorMessage error={assign.error} />
        <div className="actions">
          <Button type="submit" disabled={assign.isPending}>
            Attribuer l'épreuve
          </Button>
          <Button variant="secondary" onClick={onDone}>
            Annuler
          </Button>
        </div>
      </form>
    </Card>
  );
}

/** Épreuves du tuteur (maquette Tuteur-Epreuves) : la liste, les questions tant qu'elle n'est pas attribuée, l'attribution. */
export function TutorAssessmentsPage() {
  const queryClient = useQueryClient();
  const assessments = useQuery({ queryKey: ASSESSMENTS, queryFn: fetchAssessments });
  const assignments = useQuery({ queryKey: ["assignments"], queryFn: fetchAssignments });
  const programme = useQuery({ queryKey: ["programme"], queryFn: fetchProgramme });
  const [creating, setCreating] = useState(false);
  const [title, setTitle] = useState("");
  const [subjectId, setSubjectId] = useState("");
  const [open, setOpen] = useState<{ id: string; panel: "questions" | "assign" } | null>(null);
  const [assigned, setAssigned] = useState<string | null>(null);
  const create = useMutation({
    mutationFn: () => createAssessment(subjectId || (programme.data?.subjects[0]?.id ?? ""), title),
    onSuccess: async (created) => {
      setTitle("");
      setCreating(false);
      await queryClient.invalidateQueries({ queryKey: ASSESSMENTS });
      setOpen({ id: created.id, panel: "questions" });
    },
  });
  if (assessments.isPending) return <p role="status">Chargement…</p>;
  if (assessments.isError) return <ErrorMessage error={assessments.error} />;
  const subjectName = (id: string) =>
    programme.data?.subjects.find((subject) => subject.id === id)?.name ?? "";
  const assignmentCount = (id: string) =>
    (assignments.data?.assignments ?? []).filter((assignment) => assignment.assessmentId === id).length;

  return (
    <div className="page">
      <PageHeader
        title="Épreuves"
        actions={
          <Button
            icon={Plus}
            aria-expanded={creating}
            onClick={() => {
              setCreating(!creating);
            }}
          >
            Nouvelle épreuve
          </Button>
        }
      />
      <div className="stack">
        {creating && (
          <Card className="dashed" aria-label="Nouvelle épreuve">
            <form
              className="inline"
              onSubmit={(event) => {
                event.preventDefault();
                create.mutate();
              }}
            >
              <Field label="Matière">
                {(control) => (
                  <select
                    {...control}
                    value={subjectId}
                    onChange={(event) => {
                      setSubjectId(event.target.value);
                    }}
                  >
                    {(programme.data?.subjects ?? []).map((subject) => (
                      <option key={subject.id} value={subject.id}>
                        {subject.name}
                      </option>
                    ))}
                  </select>
                )}
              </Field>
              <Field label="Titre" className="grow">
                {(control) => (
                  <input
                    {...control}
                    required
                    maxLength={120}
                    value={title}
                    onChange={(event) => {
                      setTitle(event.target.value);
                    }}
                  />
                )}
              </Field>
              <Button type="submit" disabled={create.isPending}>
                Créer l'épreuve
              </Button>
            </form>
            <ErrorMessage error={create.error} />
          </Card>
        )}
        {assigned !== null && (
          <p role="status" className="status-line">
            Épreuve attribuée.
          </p>
        )}
        {assessments.data.assessments.length === 0 && (
          <Notice icon={ClipboardList}>Aucune épreuve pour l'instant : créez la première.</Notice>
        )}
        <ul className="boxed-rows">
          {assessments.data.assessments.map((assessment) => {
            const total = assessment.questions.reduce((sum, question) => sum + question.points, 0);
            const count = assignmentCount(assessment.id);
            const selected = open?.id === assessment.id;
            return (
              <li key={assessment.id} className={selected ? "selected" : ""}>
                <div className="row-main">
                  <p className="row-title">{assessment.title}</p>
                  <p className="row-meta">
                    {subjectName(assessment.subjectId)} · {plural(assessment.questions.length, "question")} ·{" "}
                    {numberFr(total)} point{total > 1 ? "s" : ""}
                  </p>
                </div>
                <div className="row-side">
                  {assessment.assigned ? (
                    <Pill tone="done" icon={Check}>
                      Attribuée{count > 1 ? ` ${String(count)} fois` : ""}
                    </Pill>
                  ) : assessment.questions.length === 0 ? (
                    <Pill tone="neutral" icon={Pencil}>
                      En préparation
                    </Pill>
                  ) : (
                    <Pill tone="todo">Prête, pas encore attribuée</Pill>
                  )}
                  {assessment.assigned ? (
                    <ButtonLink
                      to="/tuteur/corrections"
                      variant="secondary"
                      aria-label={`Suivre les copies : ${assessment.title}`}
                    >
                      Suivre
                    </ButtonLink>
                  ) : (
                    <Button
                      variant="secondary"
                      aria-expanded={selected && open.panel === "questions"}
                      aria-label={`Questions : ${assessment.title}`}
                      onClick={() => {
                        setOpen(
                          selected && open.panel === "questions"
                            ? null
                            : { id: assessment.id, panel: "questions" },
                        );
                      }}
                    >
                      Questions
                    </Button>
                  )}
                  {assessment.questions.length > 0 && (
                    <Button
                      aria-expanded={selected && open.panel === "assign"}
                      aria-label={`Attribuer : ${assessment.title}`}
                      onClick={() => {
                        setAssigned(null);
                        setOpen(
                          selected && open.panel === "assign" ? null : { id: assessment.id, panel: "assign" },
                        );
                      }}
                    >
                      Attribuer
                    </Button>
                  )}
                </div>
                {selected && open.panel === "questions" && (
                  <div className="stack-sm full-row">
                    <ol className="question-list">
                      {assessment.questions.map((question) => (
                        <li key={question.id}>
                          <Pill tone="neutral">{KIND_LABELS[question.kind]}</Pill> {question.prompt}{" "}
                          <span className="hint">({numberFr(question.points)} pt)</span>
                        </li>
                      ))}
                    </ol>
                    {!assessment.assigned && <QuestionEditor assessment={assessment} />}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
        {open?.panel === "assign" &&
          assessments.data.assessments
            .filter((assessment) => assessment.id === open.id)
            .map((assessment) => (
              <AssignForm
                key={assessment.id}
                assessment={assessment}
                onDone={() => {
                  setAssigned(assessment.id);
                  setOpen(null);
                }}
              />
            ))}
      </div>
    </div>
  );
}

/** File de correction, à gauche de l'espace de correction (maquette Tuteur-Corrections). */
function GradingLayout({ current, children }: { readonly current?: string; readonly children: ReactNode }) {
  const queue = useQuery({ queryKey: ["grading-queue"], queryFn: fetchGradingQueue });
  const families = useQuery({ queryKey: ["families"], queryFn: fetchFamilies });
  const nameOf = (learnerId: string) =>
    families.data?.learners.find((learner) => learner.id === learnerId)?.firstName ?? "Élève";
  const attempts = [...(queue.data?.attempts ?? [])].sort(
    (a, b) => Date.parse(a.submittedAt ?? "") - Date.parse(b.submittedAt ?? ""),
  );
  return (
    <div className="page">
      <PageHeader title="Corrections" />
      <div className="grading-layout">
        <nav aria-labelledby="file-de-correction" className="queue">
          <p className="caps" id="file-de-correction">
            {plural(attempts.length, "copie en attente", "copies en attente")}
          </p>
          <ErrorMessage error={queue.error} />
          {queue.data !== undefined && attempts.length === 0 && <p>Aucune copie à corriger.</p>}
          <ul className="plain">
            {attempts.map((attempt) => (
              <li key={attempt.attemptId}>
                <Link
                  to={`/tuteur/corrections/${attempt.attemptId}`}
                  aria-current={attempt.attemptId === current ? "page" : undefined}
                >
                  <strong>{nameOf(attempt.learnerId)}</strong>
                  <span>
                    {attempt.title}
                    {attempt.submittedAt === null ? "" : ` · ${shortDateTime(attempt.submittedAt)}`}
                  </span>
                  <span>
                    {attempt.status === "graded" ? "corrigée, à publier" : "à corriger"}
                    {attempt.late ? " · en retard" : ""}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </nav>
        <div className="min-w-0">{children}</div>
      </div>
    </div>
  );
}

export function GradingQueuePage() {
  return (
    <GradingLayout>
      <Notice icon={ClipboardList}>Choisissez une copie dans la file pour la corriger.</Notice>
    </GradingLayout>
  );
}

function answerText(attempt: TutorAttempt, questionId: string): string {
  const answer = attempt.answers[questionId];
  const question = attempt.questions.find((candidate) => candidate.id === questionId);
  if (answer === undefined) return "(sans réponse)";
  switch (answer.kind) {
    case "mcq":
      return question?.spec.kind === "mcq"
        ? question.spec.options
            .filter((option) => answer.optionIds.includes(option.id))
            .map((option) => option.text)
            .join(", ") || "(aucune option)"
        : "";
    case "numeric":
      return `${answer.value} ${answer.unit}`;
    case "short_text":
      return answer.text;
    case "notebook":
      return "(cahier ci-dessous)";
  }
}

/** Calque d'annotation d'une question de cahier : stylo rouge, texte, tampons ✓ ✗ (ADR-0004, R6). */
function NotebookAnnotation({
  attempt,
  questionId,
}: {
  readonly attempt: TutorAttempt;
  readonly questionId: string;
}) {
  const queryClient = useQueryClient();
  const answer = attempt.answers[questionId];
  const saved = attempt.annotations[questionId]?.elements ?? [];
  const [layer, setLayer] = useState<readonly unknown[] | null>(null);
  const [done, setDone] = useState(false);
  const save = useMutation({
    mutationFn: (elements: readonly unknown[]) => saveAnnotation(attempt.attemptId, questionId, elements),
    onSuccess: async () => {
      setDone(true);
      setLayer(null);
      await queryClient.invalidateQueries({ queryKey: ["tutor-attempt", attempt.attemptId] });
    },
  });
  if (answer?.kind !== "notebook") return null;
  const editable = attempt.status === "submitted" || attempt.status === "graded";
  return (
    <div className="stack-sm">
      <NotebookField
        mode={editable ? "annotate" : "view"}
        label="Cahier de l'élève et calque d'annotation"
        value={{ elements: answer.elements, formulas: formulasOf(answer.formulas) }}
        annotation={saved}
        {...(editable
          ? {
              onAnnotate: (elements: readonly unknown[]) => {
                setDone(false);
                setLayer(elements);
              },
            }
          : {})}
      />
      {editable && (
        <div>
          <Button
            variant="secondary"
            disabled={layer === null || save.isPending}
            onClick={() => {
              if (layer !== null) save.mutate(layer);
            }}
          >
            Enregistrer le calque
          </Button>
        </div>
      )}
      {done && (
        <p role="status" className="status-line">
          Calque enregistré.
        </p>
      )}
      <ErrorMessage error={save.error} />
    </div>
  );
}

const half = (value: string, delta: number, max: number) => {
  const current = Number(value.replace(",", "."));
  const next = Math.min(max, Math.max(0, (Number.isNaN(current) ? 0 : current) + delta));
  return String(next).replace(".", ",");
};

/** Espace de correction (R6, R12) : points au demi-point, mot pour l'élève, publication ; rectification motivée. */
export function GradingAttemptPage() {
  const { attemptId = "" } = useParams();
  const queryClient = useQueryClient();
  const attempt = useQuery({
    queryKey: ["tutor-attempt", attemptId],
    queryFn: () => fetchTutorAttempt(attemptId),
  });
  const families = useQuery({ queryKey: ["families"], queryFn: fetchFamilies });
  const [marks, setMarks] = useState<Record<string, { earned: string; comment: string }>>({});
  const [reason, setReason] = useState("");
  const [published, setPublished] = useState(false);
  const id = useId();
  const refresh = async () => {
    setMarks({});
    setReason("");
    await queryClient.invalidateQueries({ queryKey: ["tutor-attempt", attemptId] });
    await queryClient.invalidateQueries({ queryKey: ["grading-queue"] });
  };
  const gradesOf = () =>
    Object.entries(marks)
      .filter(([, mark]) => mark.earned !== "")
      .map(([questionId, mark]) => ({
        questionId,
        earned: Number(mark.earned.replace(",", ".")),
        ...(mark.comment.trim() === "" ? {} : { comment: mark.comment }),
      }));
  const grade = useMutation({ mutationFn: () => gradeAttempt(attemptId, gradesOf()), onSuccess: refresh });
  // « Publier la note » enregistre d'abord la correction en cours : le serveur exige toujours une copie
  // entièrement corrigée avant de publier (R6), rien ne change de ce côté.
  const publish = useMutation({
    mutationFn: async () => {
      if (gradesOf().length > 0) await gradeAttempt(attemptId, gradesOf());
      await publishAttempt(attemptId);
    },
    onSuccess: async () => {
      setPublished(true);
      await refresh();
    },
  });
  const [revealed, setRevealed] = useState(false);
  const reveal = useMutation({
    mutationFn: (assignmentId: string) => revealAnswers(assignmentId),
    onSuccess: () => {
      setRevealed(true);
    },
  });
  const rectify = useMutation({
    mutationFn: ([questionId, earned]: [string, string]) =>
      rectifyGrade(attemptId, { questionId, earned: Number(earned.replace(",", ".")), reason }),
    onSuccess: refresh,
  });
  if (attempt.isPending)
    return (
      <GradingLayout current={attemptId}>
        <p role="status">Chargement…</p>
      </GradingLayout>
    );
  if (attempt.isError)
    return (
      <GradingLayout current={attemptId}>
        <ErrorMessage error={attempt.error} />
      </GradingLayout>
    );
  const data = attempt.data;
  const isPublished = data.status === "published";
  const learnerName =
    families.data?.learners.find((learner) => learner.id === data.learnerId)?.firstName ?? "Élève";
  const auto = data.results.filter((result) => result.gradedBy === "auto");
  const autoEarned = auto.reduce((sum, result) => sum + (result.earned ?? 0), 0);
  const autoMax = auto.reduce(
    (sum, result) =>
      sum + (data.questions.find((question) => question.id === result.questionId)?.points ?? 0),
    0,
  );

  return (
    <GradingLayout current={attemptId}>
      <Card aria-labelledby="copie">
        <div className="card-head">
          <h2 id="copie">
            {learnerName} · {data.title}
          </h2>
          {auto.length > 0 && (
            <p className="hint">
              {plural(auto.length, "question corrigée", "questions corrigées")} automatiquement :{" "}
              {numberFr(autoEarned)} / {numberFr(autoMax)}
            </p>
          )}
        </div>
        <p className="hint">
          Essai {data.number} · {data.late ? "rendu en retard" : "rendu à temps"}
          {data.answersSha256 === null ? "" : ` · empreinte ${data.answersSha256.slice(0, 12)}…`}
        </p>
        <ol className="stack plain">
          {data.questions.map((question, position) => {
            const result = data.results.find((candidate) => candidate.questionId === question.id);
            const mark = marks[question.id] ?? { earned: "", comment: "" };
            const setMark = (changes: Partial<typeof mark>) => {
              setMarks({ ...marks, [question.id]: { ...mark, ...changes } });
            };
            const shown =
              mark.earned !== ""
                ? mark.earned
                : result?.earned === null || result?.earned === undefined
                  ? ""
                  : String(result.earned).replace(".", ",");
            return (
              <li key={question.id} className="grading-question">
                <p className="row-title">
                  Question {position + 1} · {KIND_LABELS[question.kind].toLowerCase()} ·{" "}
                  {numberFr(question.points)} point{question.points > 1 ? "s" : ""}
                  {result?.gradedBy === "auto" && <span className="hint"> · corrigée automatiquement</span>}
                </p>
                <p>{question.prompt}</p>
                <p>
                  <strong>Réponse :</strong> {answerText(data, question.id)}
                </p>
                <NotebookAnnotation attempt={data} questionId={question.id} />
                <div className="inline">
                  <div className="field">
                    <label htmlFor={`${id}-${question.id}-earned`}>
                      {isPublished ? "Nouvelle note" : "Points"}
                    </label>
                    <div className="points-stepper">
                      <Button
                        variant="secondary"
                        className="btn-icon"
                        icon={Minus}
                        aria-label="Retirer un demi-point"
                        onClick={() => {
                          setMark({ earned: half(shown, -0.5, question.points) });
                        }}
                      />
                      <input
                        id={`${id}-${question.id}-earned`}
                        inputMode="decimal"
                        value={shown}
                        placeholder="—"
                        onChange={(event) => {
                          setMark({ earned: event.target.value });
                        }}
                      />
                      <span aria-hidden="true">/ {numberFr(question.points)}</span>
                      <Button
                        variant="secondary"
                        className="btn-icon"
                        icon={Plus}
                        aria-label="Ajouter un demi-point"
                        onClick={() => {
                          setMark({ earned: half(shown, 0.5, question.points) });
                        }}
                      />
                    </div>
                  </div>
                  {!isPublished && (
                    <Field label="Mot pour l'élève" className="grow">
                      {(control) => (
                        <input
                          {...control}
                          maxLength={1000}
                          value={mark.comment}
                          placeholder={result?.comment ?? ""}
                          onChange={(event) => {
                            setMark({ comment: event.target.value });
                          }}
                        />
                      )}
                    </Field>
                  )}
                  {isPublished && (
                    <Button
                      variant="secondary"
                      disabled={mark.earned === "" || reason.trim() === ""}
                      onClick={() => {
                        rectify.mutate([question.id, mark.earned]);
                      }}
                    >
                      Rectifier
                    </Button>
                  )}
                </div>
              </li>
            );
          })}
        </ol>
        {isPublished ? (
          <div className="stack-sm section-gap">
            <Field
              label="Motif de la rectification"
              hint="Obligatoire, conservé dans l'historique et le journal d'audit."
            >
              {(control) => (
                <input
                  {...control}
                  maxLength={500}
                  value={reason}
                  onChange={(event) => {
                    setReason(event.target.value);
                  }}
                />
              )}
            </Field>
            {data.rectifications.length > 0 && (
              <>
                <h3>Historique des rectifications</h3>
                <ul className="rows">
                  {data.rectifications.map((entry) => (
                    <li key={entry.id}>
                      {shortDateTime(entry.rectifiedAt)} : {numberFr(entry.previousGrade)} →{" "}
                      {numberFr(entry.newGrade)} / 20 — {entry.reason}
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>
        ) : null}
        <div className="grading-footer">
          <p className="row-title">
            Note finale : {data.grade === null ? "en attente" : `${numberFr(data.grade)} / 20`}
            {isPublished && " · publiée"}
          </p>
          {!isPublished && (
            <div className="actions">
              <Button
                variant="secondary"
                disabled={gradesOf().length === 0 || grade.isPending}
                onClick={() => {
                  grade.mutate();
                }}
              >
                Enregistrer sans publier
              </Button>
              <Button
                disabled={publish.isPending || (data.status !== "graded" && gradesOf().length === 0)}
                onClick={() => {
                  publish.mutate();
                }}
              >
                Publier la note
              </Button>
            </div>
          )}
        </div>
        {published && (
          <p role="status" className="status-line">
            Note publiée.
          </p>
        )}
        <ErrorMessage error={grade.error ?? publish.error ?? rectify.error ?? reveal.error} />
      </Card>
      <Card className="section-gap" aria-labelledby="corrige">
        <h2 id="corrige">Corrigé</h2>
        <p className="hint">
          Le corrigé (réponses attendues, explications) est montré à tous les élèves de l'attribution en même
          temps : automatiquement à la date limite si le retard n'est pas autorisé, sinon quand vous le
          révélez.
        </p>
        {revealed ? (
          <p role="status" className="status-line">
            Corrigé révélé.
          </p>
        ) : (
          <Button
            variant="secondary"
            onClick={() => {
              if (
                window.confirm("Révéler le corrigé à tous les élèves de cette attribution ? C'est définitif.")
              ) {
                reveal.mutate(data.assignmentId);
              }
            }}
          >
            Révéler le corrigé
          </Button>
        )}
      </Card>
    </GradingLayout>
  );
}
