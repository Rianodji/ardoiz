import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useId, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import {
  fetchAttempt,
  fetchMyAssignments,
  fetchPublishedResults,
  saveDraft,
  startAttempt,
  submitAttempt,
  type Answer,
  type LearnerAttempt,
} from "../api/assessment";
import { ErrorMessage } from "../components/ErrorMessage";
import { formulasOf, NotebookField } from "../notebook/NotebookField";

const dateTime = (iso: string) =>
  new Intl.DateTimeFormat("fr-FR", {
    dateStyle: "full",
    timeStyle: "short",
    timeZone: "Europe/Paris",
  }).format(new Date(iso));
const points = (value: number) => `${String(value).replace(".", ",")} pt${value > 1 ? "s" : ""}`;
const grade = (value: number) => `${String(value).replace(".", ",")} / 20`;

const STATE_LABELS = {
  upcoming: "bientôt",
  open: "à faire",
  in_progress: "commencée",
  submitted: "rendue",
  published: "corrigée",
  closed: "fermée",
} as const;

/** Les épreuves de l'élève, avec leur état ; la note n'apparaît qu'après publication (R5). */
export function MyAssignments() {
  const navigate = useNavigate();
  const assignments = useQuery({ queryKey: ["my-assignments"], queryFn: fetchMyAssignments });
  const start = useMutation({
    mutationFn: startAttempt,
    onSuccess: (attempt) => navigate(`/copie/${attempt.attemptId}`),
  });
  if (assignments.isPending) return <p role="status">Chargement…</p>;
  if (assignments.isError) return <ErrorMessage error={assignments.error} />;
  if (assignments.data.assignments.length === 0) return <p>Aucune épreuve pour le moment.</p>;
  return (
    <>
      <ErrorMessage error={start.error} />
      <ul className="lesson-list">
        {assignments.data.assignments.map((assignment) => (
          <li key={assignment.assignmentId} className="lesson-row">
            <span>
              <strong>{assignment.title}</strong> — à rendre avant le {dateTime(assignment.dueAt)}
            </span>
            <span className={`badge ${assignment.state === "published" ? "done" : "todo"}`}>
              {STATE_LABELS[assignment.state]}
            </span>
            {assignment.grade !== null && <span>{grade(assignment.grade)}</span>}
            {(assignment.state === "open" || assignment.state === "in_progress") && (
              <button
                type="button"
                className="button"
                disabled={start.isPending}
                onClick={() => {
                  start.mutate(assignment.assignmentId);
                }}
              >
                {assignment.state === "open" ? "Commencer" : "Reprendre"}
              </button>
            )}
            {(assignment.state === "submitted" || assignment.state === "published") &&
              assignment.currentAttemptId !== null && (
                <>
                  <Link to={`/copie/${assignment.currentAttemptId}`}>Voir ma copie</Link>
                  {assignment.state === "submitted" && assignment.attemptsLeft > 0 && (
                    <button
                      type="button"
                      className="button secondary"
                      onClick={() => {
                        start.mutate(assignment.assignmentId);
                      }}
                    >
                      Nouvelle tentative
                    </button>
                  )}
                </>
              )}
          </li>
        ))}
      </ul>
    </>
  );
}

/** Résultats publiés d'un élève, pour lui-même ou son parent. */
export function PublishedResults({ learnerId }: { readonly learnerId: string }) {
  const results = useQuery({
    queryKey: ["results", learnerId],
    queryFn: () => fetchPublishedResults(learnerId),
  });
  if (results.isPending) return <p role="status">Chargement…</p>;
  if (results.isError) return <ErrorMessage error={results.error} />;
  if (results.data.results.length === 0) return <p>Aucun résultat publié pour le moment.</p>;
  return (
    <ul>
      {results.data.results.map((result) => (
        <li key={result.attemptId}>
          <Link to={`/copie/${result.attemptId}`}>{result.title}</Link> :{" "}
          {result.grade === null ? "—" : grade(result.grade)}
        </li>
      ))}
    </ul>
  );
}

function AnswerField({
  attempt,
  question,
  answer,
  disabled,
  onChange,
}: {
  readonly attempt: LearnerAttempt;
  readonly question: LearnerAttempt["questions"][number];
  readonly answer: Answer | undefined;
  readonly disabled: boolean;
  readonly onChange: (answer: Answer) => void;
}) {
  const id = useId();
  switch (question.kind) {
    case "mcq": {
      const chosen = answer?.kind === "mcq" ? answer.optionIds : [];
      return (
        <fieldset disabled={disabled}>
          <legend className="visually-hidden">Choisis la ou les bonnes réponses</legend>
          {question.options.map((option) => (
            <label key={option.id} className="choice">
              <input
                type="checkbox"
                checked={chosen.includes(option.id)}
                onChange={(event) => {
                  onChange({
                    kind: "mcq",
                    optionIds: event.target.checked
                      ? [...chosen, option.id]
                      : chosen.filter((other) => other !== option.id),
                  });
                }}
              />
              {option.text}
            </label>
          ))}
        </fieldset>
      );
    }
    case "numeric": {
      const current =
        answer?.kind === "numeric"
          ? answer
          : { kind: "numeric" as const, value: "", unit: question.units[0] ?? "" };
      return (
        <div className="inline">
          <label htmlFor={`${id}-value`}>Ta réponse</label>
          <input
            id={`${id}-value`}
            inputMode="decimal"
            maxLength={32}
            disabled={disabled}
            value={current.value}
            onChange={(event) => {
              onChange({ ...current, value: event.target.value });
            }}
          />
          <label htmlFor={`${id}-unit`}>Unité</label>
          <select
            id={`${id}-unit`}
            disabled={disabled}
            value={current.unit}
            onChange={(event) => {
              onChange({ ...current, unit: event.target.value });
            }}
          >
            {question.units.map((unit) => (
              <option key={unit} value={unit}>
                {unit}
              </option>
            ))}
          </select>
        </div>
      );
    }
    case "short_text":
      return (
        <>
          <label htmlFor={id}>Ta réponse</label>
          <textarea
            id={id}
            maxLength={2000}
            rows={4}
            disabled={disabled}
            value={answer?.kind === "short_text" ? answer.text : ""}
            onChange={(event) => {
              onChange({ kind: "short_text", text: event.target.value });
            }}
          />
        </>
      );
    case "notebook": {
      const value = {
        elements: answer?.kind === "notebook" ? answer.elements : [],
        formulas: formulasOf(answer?.kind === "notebook" ? answer.formulas : []),
      };
      // Copie corrigée : le calque du tuteur se superpose à la scène, sans la modifier (R6).
      const annotation = attempt.correction?.questions.find(
        (entry) => entry.questionId === question.id,
      )?.annotation;
      return (
        <NotebookField
          mode={disabled ? "view" : "edit"}
          label={`Cahier : ${question.prompt}`}
          value={value}
          attemptId={attempt.attemptId}
          {...(annotation === null || annotation === undefined ? {} : { annotation: annotation.elements })}
          onChange={(next) => {
            onChange({ kind: "notebook", elements: [...next.elements], formulas: [...next.formulas] });
          }}
        />
      );
    }
  }
}

/**
 * Points d'une question dès la publication ; réponse attendue et explication seulement après la
 * révélation du corrigé (R5, verdict L3 R-1).
 */
function CorrectionOf({
  attempt,
  questionId,
}: {
  readonly attempt: LearnerAttempt;
  readonly questionId: string;
}) {
  const entry = attempt.correction?.questions.find((candidate) => candidate.questionId === questionId);
  if (entry === undefined) return null;
  const key = attempt.answerKey?.questions.find((candidate) => candidate.questionId === questionId);
  const question = attempt.questions.find((candidate) => candidate.id === questionId);
  let expected: string | null = null;
  if (key !== undefined) {
    const solution = key.expected;
    expected =
      solution.kind === "mcq"
        ? (question?.kind === "mcq" ? question.options : [])
            .filter((option) => solution.correctOptionIds.includes(option.id))
            .map((option) => option.text)
            .join(", ")
        : solution.kind === "numeric"
          ? `${solution.expected.replace(".", ",")} ${solution.unit}`
          : solution.modelAnswer;
  }
  return (
    <div className="correction" aria-label="Correction">
      <p>
        <strong>{points(entry.earned)}</strong>
        {expected !== null && expected !== "" && <> · Réponse attendue : {expected}</>}
      </p>
      {key?.explanation !== undefined && key.explanation !== null && <p>{key.explanation}</p>}
      {entry.comment !== null && <p>Commentaire du tuteur : {entry.comment}</p>}
    </div>
  );
}

const DRAFT_DELAY_MS = 6_000;

/** Une copie : à remplir tant qu'elle est en brouillon, puis figée ; corrigé après publication. */
export function AttemptPage() {
  const { attemptId = "" } = useParams();
  const queryClient = useQueryClient();
  const attempt = useQuery({ queryKey: ["attempt", attemptId], queryFn: () => fetchAttempt(attemptId) });
  const [answers, setAnswers] = useState<Record<string, Answer> | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const draft = useMutation({
    mutationFn: (current: Record<string, Answer>) => saveDraft(attemptId, current),
    onSuccess: () => {
      setStatus("Enregistré.");
    },
  });
  const submit = useMutation({
    mutationFn: (current: Record<string, Answer>) => submitAttempt(attemptId, current),
    onSuccess: async (result) => {
      queryClient.setQueryData(["attempt", attemptId], result);
      await queryClient.invalidateQueries({ queryKey: ["my-assignments"] });
      setStatus("Copie rendue.");
    },
  });
  useEffect(
    () => () => {
      if (timer.current !== null) clearTimeout(timer.current);
    },
    [],
  );

  if (attempt.isPending) return <p role="status">Chargement…</p>;
  if (attempt.isError) return <ErrorMessage error={attempt.error} />;
  const data = attempt.data;
  const editable = data.status === "draft";
  const current = answers ?? data.answers;
  const change = (questionId: string, answer: Answer) => {
    const next = { ...current, [questionId]: answer };
    setAnswers(next);
    setStatus("Modifications pas encore enregistrées…");
    // Sauvegarde automatique, espacée : le serveur refuse plus d'une sauvegarde toutes les 5 s (R15).
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      draft.mutate(next);
    }, DRAFT_DELAY_MS);
  };

  return (
    <section className="card wide">
      <h1>{data.title}</h1>
      <p>
        Tentative {data.number} · à rendre avant le {dateTime(data.dueAt)}
        {data.late && <span className="badge todo"> rendue en retard</span>}
      </p>
      {data.correction !== null && <p className="grade">Note : {grade(data.correction.grade)}</p>}
      {data.correction !== null && data.answerKey === null && (
        <p className="hint">Le corrigé sera disponible après la date limite.</p>
      )}
      {!editable && data.correction === null && (
        <p className="hint">Copie rendue : ton tuteur la corrige. La note apparaîtra ici.</p>
      )}
      <ol className="questions">
        {data.questions.map((question) => (
          <li key={question.id}>
            <p>
              {question.prompt} <span className="hint">({points(question.points)})</span>
            </p>
            <AnswerField
              attempt={data}
              question={question}
              answer={current[question.id]}
              disabled={!editable}
              onChange={(answer) => {
                change(question.id, answer);
              }}
            />
            <CorrectionOf attempt={data} questionId={question.id} />
          </li>
        ))}
      </ol>
      <ErrorMessage error={draft.error ?? submit.error} />
      {status !== null && <p role="status">{status}</p>}
      {editable && (
        <div className="actions">
          <button
            type="button"
            className="button secondary"
            disabled={draft.isPending}
            onClick={() => {
              draft.mutate(current);
            }}
          >
            Enregistrer le brouillon
          </button>
          <button
            type="button"
            className="button"
            disabled={submit.isPending}
            onClick={() => {
              if (!window.confirm("Rendre ta copie ? Tu ne pourras plus la modifier.")) return;
              if (timer.current !== null) clearTimeout(timer.current);
              submit.mutate(current);
            }}
          >
            Rendre ma copie
          </button>
        </div>
      )}
    </section>
  );
}
