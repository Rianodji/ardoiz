import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useId, useState } from "react";
import { Link, useParams } from "react-router";
import {
  assignAssessment,
  createAssessment,
  fetchAssessments,
  fetchGradingQueue,
  fetchTutorAttempt,
  gradeAttempt,
  publishAttempt,
  rectifyGrade,
  revealAnswers,
  saveQuestions,
  type AuthorAssessment,
  type QuestionInput,
  type TutorAttempt,
} from "../api/assessment";
import { fetchCompetencyChoices, fetchGroups, fetchProgramme } from "../api/curriculum";
import { fetchFamilies } from "../api/identity";
import { ErrorMessage } from "../components/ErrorMessage";

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

const KIND_LABELS = { mcq: "QCM", numeric: "Numérique", short_text: "Réponse courte" } as const;
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
      return {
        kind: "short_text",
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
              return {
                kind: "short_text",
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
      <button
        type="button"
        className="button secondary"
        onClick={() => {
          setDraft(blankQuestion(choices[0]?.id ?? ""));
        }}
      >
        Ajouter une question
      </button>
    );
  const set = (changes: Partial<QuestionDraft>) => {
    setDraft({ ...draft, ...changes });
  };
  return (
    <form
      className="stack"
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
      {draft.kind === "short_text" && (
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
        <button type="submit" className="button">
          Enregistrer la question
        </button>
        <button
          type="button"
          className="button secondary"
          onClick={() => {
            setDraft(null);
          }}
        >
          Annuler
        </button>
      </div>
    </form>
  );
}

function AssignForm({ assessment }: { readonly assessment: AuthorAssessment }) {
  const families = useQuery({ queryKey: ["families"], queryFn: fetchFamilies });
  const groups = useQuery({ queryKey: ["groups"], queryFn: fetchGroups });
  const queryClient = useQueryClient();
  const id = useId();
  const [audience, setAudience] = useState("");
  const [opensAt, setOpensAt] = useState("");
  const [dueAt, setDueAt] = useState("");
  const [maxAttempts, setMaxAttempts] = useState("1");
  const [lateAllowed, setLateAllowed] = useState(false);
  const [publication, setPublication] = useState<"auto" | "manual">("manual");
  const [done, setDone] = useState(false);
  const assign = useMutation({
    mutationFn: () => {
      const [kind, targetId = ""] = audience.split(":");
      return assignAssessment({
        assessmentId: assessment.id,
        audience: { kind: kind === "group" ? "group" : "learner", id: targetId },
        opensAt: new Date(opensAt).toISOString(),
        dueAt: new Date(dueAt).toISOString(),
        maxAttempts: Number(maxAttempts),
        lateAllowed,
        publication,
      });
    },
    onSuccess: async () => {
      setDone(true);
      await queryClient.invalidateQueries({ queryKey: ASSESSMENTS });
    },
  });
  return (
    <form
      className="stack"
      onSubmit={(event) => {
        event.preventDefault();
        assign.mutate();
      }}
    >
      <label htmlFor={`${id}-audience`}>Pour</label>
      <select
        id={`${id}-audience`}
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
          </option>
        ))}
        {(families.data?.learners ?? []).map((learner) => (
          <option key={learner.id} value={`learner:${learner.id}`}>
            {learner.firstName}
          </option>
        ))}
      </select>
      <label htmlFor={`${id}-opens`}>Ouverture</label>
      <input
        id={`${id}-opens`}
        type="datetime-local"
        required
        value={opensAt}
        onChange={(event) => {
          setOpensAt(event.target.value);
        }}
      />
      <label htmlFor={`${id}-due`}>Date limite</label>
      <input
        id={`${id}-due`}
        type="datetime-local"
        required
        value={dueAt}
        onChange={(event) => {
          setDueAt(event.target.value);
        }}
      />
      <label htmlFor={`${id}-attempts`}>Nombre de tentatives</label>
      <input
        id={`${id}-attempts`}
        type="number"
        min={1}
        max={10}
        value={maxAttempts}
        onChange={(event) => {
          setMaxAttempts(event.target.value);
        }}
      />
      <label className="choice">
        <input
          type="checkbox"
          checked={lateAllowed}
          onChange={(event) => {
            setLateAllowed(event.target.checked);
          }}
        />
        Accepter un rendu en retard (la copie sera marquée « en retard »)
      </label>
      <label htmlFor={`${id}-publication`}>Publication de la correction</label>
      <select
        id={`${id}-publication`}
        value={publication}
        onChange={(event) => {
          setPublication(event.target.value as "auto" | "manual");
        }}
      >
        <option value="manual">quand je la publie</option>
        <option value="auto">dès que tout est corrigé automatiquement</option>
      </select>
      <ErrorMessage error={assign.error} />
      {done && <p role="status">Épreuve attribuée.</p>}
      <button type="submit" className="button">
        Attribuer
      </button>
    </form>
  );
}

/** Épreuves du tuteur : création, questions (tant qu'elle n'est pas attribuée), attribution. */
export function TutorAssessmentsPage() {
  const queryClient = useQueryClient();
  const assessments = useQuery({ queryKey: ASSESSMENTS, queryFn: fetchAssessments });
  const programme = useQuery({ queryKey: ["programme"], queryFn: fetchProgramme });
  const [title, setTitle] = useState("");
  const [subjectId, setSubjectId] = useState("");
  const id = useId();
  const create = useMutation({
    mutationFn: () => createAssessment(subjectId || (programme.data?.subjects[0]?.id ?? ""), title),
    onSuccess: async () => {
      setTitle("");
      await queryClient.invalidateQueries({ queryKey: ASSESSMENTS });
    },
  });
  if (assessments.isPending) return <p role="status">Chargement…</p>;
  if (assessments.isError) return <ErrorMessage error={assessments.error} />;
  return (
    <div className="stack wide">
      <section className="card wide">
        <h1>Épreuves</h1>
        <p>
          <Link to="/tuteur/corrections">File de correction</Link>
        </p>
        <form
          className="inline"
          onSubmit={(event) => {
            event.preventDefault();
            create.mutate();
          }}
        >
          <label htmlFor={`${id}-subject`}>Matière</label>
          <select
            id={`${id}-subject`}
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
          <label htmlFor={`${id}-title`}>Titre</label>
          <input
            id={`${id}-title`}
            required
            maxLength={120}
            value={title}
            onChange={(event) => {
              setTitle(event.target.value);
            }}
          />
          <button type="submit" className="button">
            Créer l'épreuve
          </button>
        </form>
        <ErrorMessage error={create.error} />
      </section>
      {assessments.data.assessments.map((assessment) => (
        <section key={assessment.id} className="card wide">
          <h2>
            {assessment.title}{" "}
            <span className={`badge ${assessment.assigned ? "done" : "todo"}`}>
              {assessment.assigned ? "attribuée" : "en préparation"}
            </span>
          </h2>
          <ol>
            {assessment.questions.map((question) => (
              <li key={question.id}>
                [{KIND_LABELS[question.kind]}] {question.prompt} ({question.points} pt)
              </li>
            ))}
          </ol>
          {!assessment.assigned && <QuestionEditor assessment={assessment} />}
          {assessment.questions.length > 0 && (
            <details>
              <summary>Attribuer</summary>
              <AssignForm assessment={assessment} />
            </details>
          )}
        </section>
      ))}
    </div>
  );
}

/** File de correction : copies rendues non publiées, les plus anciennes d'abord. */
export function GradingQueuePage() {
  const queue = useQuery({ queryKey: ["grading-queue"], queryFn: fetchGradingQueue });
  const families = useQuery({ queryKey: ["families"], queryFn: fetchFamilies });
  if (queue.isPending) return <p role="status">Chargement…</p>;
  if (queue.isError) return <ErrorMessage error={queue.error} />;
  const nameOf = (learnerId: string) =>
    families.data?.learners.find((learner) => learner.id === learnerId)?.firstName ?? "Élève";
  return (
    <section className="card wide">
      <h1>File de correction</h1>
      {queue.data.attempts.length === 0 && <p>Aucune copie à corriger.</p>}
      <ul className="lesson-list">
        {queue.data.attempts.map((attempt) => (
          <li key={attempt.attemptId} className="lesson-row">
            <Link to={`/tuteur/corrections/${attempt.attemptId}`}>
              {attempt.title} — {nameOf(attempt.learnerId)}
            </Link>
            <span className={`badge ${attempt.status === "graded" ? "done" : "todo"}`}>
              {attempt.status === "graded" ? "corrigée, à publier" : "à corriger"}
            </span>
            {attempt.late && <span className="badge todo">en retard</span>}
          </li>
        ))}
      </ul>
    </section>
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
  }
}

/** Détail d'une copie pour le tuteur : correction manuelle, publication, rectification motivée (R6, R12). */
export function GradingAttemptPage() {
  const { attemptId = "" } = useParams();
  const queryClient = useQueryClient();
  const attempt = useQuery({
    queryKey: ["tutor-attempt", attemptId],
    queryFn: () => fetchTutorAttempt(attemptId),
  });
  const [marks, setMarks] = useState<Record<string, { earned: string; comment: string }>>({});
  const [reason, setReason] = useState("");
  const id = useId();
  const refresh = async () => {
    setMarks({});
    setReason("");
    await queryClient.invalidateQueries({ queryKey: ["tutor-attempt", attemptId] });
    await queryClient.invalidateQueries({ queryKey: ["grading-queue"] });
  };
  const grade = useMutation({
    mutationFn: () =>
      gradeAttempt(
        attemptId,
        Object.entries(marks).map(([questionId, mark]) => ({
          questionId,
          earned: Number(mark.earned.replace(",", ".")),
          ...(mark.comment.trim() === "" ? {} : { comment: mark.comment }),
        })),
      ),
    onSuccess: refresh,
  });
  const publish = useMutation({ mutationFn: () => publishAttempt(attemptId), onSuccess: refresh });
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
  if (attempt.isPending) return <p role="status">Chargement…</p>;
  if (attempt.isError) return <ErrorMessage error={attempt.error} />;
  const data = attempt.data;
  const published = data.status === "published";
  return (
    <section className="card wide">
      <p>
        <Link to="/tuteur/corrections">← File de correction</Link>
      </p>
      <h1>{data.title}</h1>
      <p>
        Tentative {data.number} · {data.late ? "rendue en retard" : "rendue à temps"} · note :{" "}
        {data.grade === null ? "en attente" : `${String(data.grade)} / 20`}
      </p>
      <p className="hint">Empreinte de la copie : {data.answersSha256}</p>
      <ol className="questions">
        {data.questions.map((question) => {
          const result = data.results.find((candidate) => candidate.questionId === question.id);
          const mark = marks[question.id] ?? { earned: "", comment: "" };
          const setMark = (changes: Partial<typeof mark>) => {
            setMarks({ ...marks, [question.id]: { ...mark, ...changes } });
          };
          return (
            <li key={question.id}>
              <p>
                {question.prompt} ({question.points} pt)
              </p>
              <p>Réponse : {answerText(data, question.id)}</p>
              <p>
                Points : {result?.earned ?? "à corriger"}{" "}
                {result?.gradedBy === "auto" && <span className="hint">(corrigé automatiquement)</span>}
              </p>
              <div className="inline">
                <label htmlFor={`${id}-${question.id}-earned`}>
                  {published ? "Nouvelle note" : "Points obtenus"}
                </label>
                <input
                  id={`${id}-${question.id}-earned`}
                  inputMode="decimal"
                  value={mark.earned}
                  onChange={(event) => {
                    setMark({ earned: event.target.value });
                  }}
                />
                {!published && (
                  <>
                    <label htmlFor={`${id}-${question.id}-comment`}>Commentaire</label>
                    <input
                      id={`${id}-${question.id}-comment`}
                      maxLength={1000}
                      value={mark.comment}
                      onChange={(event) => {
                        setMark({ comment: event.target.value });
                      }}
                    />
                  </>
                )}
                {published && (
                  <button
                    type="button"
                    className="button secondary"
                    disabled={mark.earned === ""}
                    onClick={() => {
                      rectify.mutate([question.id, mark.earned]);
                    }}
                  >
                    Rectifier
                  </button>
                )}
              </div>
            </li>
          );
        })}
      </ol>
      {published ? (
        <>
          <label htmlFor={`${id}-reason`}>
            Motif de la rectification (obligatoire, conservé dans l'historique)
          </label>
          <input
            id={`${id}-reason`}
            maxLength={500}
            value={reason}
            onChange={(event) => {
              setReason(event.target.value);
            }}
          />
          {data.rectifications.length > 0 && (
            <>
              <h2>Historique des rectifications</h2>
              <ul>
                {data.rectifications.map((entry) => (
                  <li key={entry.id}>
                    {new Date(entry.rectifiedAt).toLocaleString("fr-FR")} : {entry.previousGrade} →{" "}
                    {entry.newGrade} / 20 — {entry.reason}
                  </li>
                ))}
              </ul>
            </>
          )}
        </>
      ) : (
        <div className="actions">
          <button
            type="button"
            className="button secondary"
            disabled={Object.keys(marks).length === 0}
            onClick={() => {
              grade.mutate();
            }}
          >
            Enregistrer la correction
          </button>
          <button
            type="button"
            className="button"
            disabled={data.status !== "graded"}
            onClick={() => {
              publish.mutate();
            }}
          >
            Publier la correction
          </button>
        </div>
      )}
      <h2>Corrigé</h2>
      <p className="hint">
        Le corrigé (réponses attendues, explications) est montré à tous les élèves de l'attribution en même
        temps : automatiquement à la date limite si le retard n'est pas autorisé, sinon quand vous le révélez.
      </p>
      <button
        type="button"
        className="button secondary"
        disabled={revealed}
        onClick={() => {
          if (
            window.confirm("Révéler le corrigé à tous les élèves de cette attribution ? C'est définitif.")
          ) {
            reveal.mutate(data.assignmentId);
          }
        }}
      >
        Révéler le corrigé
      </button>
      {revealed && <p role="status">Corrigé révélé.</p>}
      <ErrorMessage error={grade.error ?? publish.error ?? rectify.error ?? reveal.error} />
    </section>
  );
}
