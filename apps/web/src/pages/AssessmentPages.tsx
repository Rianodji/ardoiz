import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { fetchAttempt, saveDraft, submitAttempt, type Answer, type LearnerAttempt } from "../api/assessment";
import { useMe } from "../auth/session";
import { ErrorMessage } from "../components/ErrorMessage";
import { useFocusMode } from "../layout/focus";
import { formulasOf, NotebookField } from "../notebook/NotebookField";
import { Button, Card, Field, Icon, Notice, Pill } from "../ui";
import { longDate, longDateTime, numberFr, plural, weekdayHour } from "../ui/format";
import { Check, ChevronLeft, ChevronRight, Clock, Lock, RotateCcw } from "../ui/icons";

type Question = LearnerAttempt["questions"][number];

const points = (value: number) => `${numberFr(value)} point${value > 1 ? "s" : ""}`;

const KIND_HINTS: Readonly<Record<Question["kind"], string>> = {
  mcq: "Plusieurs réponses possibles",
  numeric: "Un nombre et son unité",
  short_text: "Réponse courte",
  notebook: "Sur ton cahier",
};

/** Une question est-elle répondue ? (pastilles de questions, rappel avant de rendre). */
function isAnswered(answer: Answer | undefined): boolean {
  if (answer === undefined) return false;
  switch (answer.kind) {
    case "mcq":
      return answer.optionIds.length > 0;
    case "numeric":
      return answer.value.trim() !== "";
    case "short_text":
      return answer.text.trim() !== "";
    case "notebook":
      return answer.elements.length > 0 || (answer.formulas ?? []).length > 0;
  }
}

function AnswerField({
  attempt,
  question,
  answer,
  disabled,
  onChange,
}: {
  readonly attempt: LearnerAttempt;
  readonly question: Question;
  readonly answer: Answer | undefined;
  readonly disabled: boolean;
  readonly onChange: (answer: Answer) => void;
}) {
  switch (question.kind) {
    case "mcq": {
      const chosen = answer?.kind === "mcq" ? answer.optionIds : [];
      return (
        <fieldset disabled={disabled}>
          <legend className="visually-hidden">Coche la ou les bonnes réponses</legend>
          <div className="mcq-options">
            {question.options.map((option) => (
              <label key={option.id}>
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
          </div>
        </fieldset>
      );
    }
    case "numeric": {
      const current =
        answer?.kind === "numeric"
          ? answer
          : { kind: "numeric" as const, value: "", unit: question.units[0] ?? "" };
      return (
        <div className="answer-inline">
          <Field label="Ta réponse">
            {(control) => (
              <input
                {...control}
                inputMode="decimal"
                maxLength={32}
                disabled={disabled}
                value={current.value}
                onChange={(event) => {
                  onChange({ ...current, value: event.target.value });
                }}
              />
            )}
          </Field>
          <Field label="Unité">
            {(control) => (
              <select
                {...control}
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
            )}
          </Field>
        </div>
      );
    }
    case "short_text":
      return (
        <Field label="Ta réponse">
          {(control) => (
            <textarea
              {...control}
              maxLength={2000}
              rows={4}
              disabled={disabled}
              value={answer?.kind === "short_text" ? answer.text : ""}
              onChange={(event) => {
                onChange({ kind: "short_text", text: event.target.value });
              }}
            />
          )}
        </Field>
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

const DRAFT_DELAY_MS = 6_000;
type SaveState = "saved" | "dirty" | "saving";

/**
 * Épreuve en mode focus (maquette Eleve-Epreuve) : une question à la fois, des pastilles pour
 * circuler, « Enregistré » visible, « Arrêter et reprendre plus tard », et une confirmation avant de
 * rendre (le rendu est définitif, R6).
 */
function FocusAttempt({ data }: { readonly data: LearnerAttempt }) {
  useFocusMode(true);
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [answers, setAnswers] = useState<Record<string, Answer>>(data.answers);
  const [index, setIndex] = useState(0);
  const [saveState, setSaveState] = useState<SaveState>("saved");
  const [confirming, setConfirming] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const questionHeading = useRef<HTMLHeadingElement>(null);
  const draft = useMutation({
    mutationFn: (current: Record<string, Answer>) => saveDraft(data.attemptId, current),
    onMutate: () => {
      setSaveState("saving");
    },
    onSuccess: () => {
      setSaveState("saved");
    },
    onError: () => {
      setSaveState("dirty");
    },
  });
  const submit = useMutation({
    mutationFn: (current: Record<string, Answer>) => submitAttempt(data.attemptId, current),
    onSuccess: async (result) => {
      queryClient.setQueryData(["attempt", data.attemptId], result);
      await queryClient.invalidateQueries({ queryKey: ["my-assignments"] });
    },
  });
  useEffect(
    () => () => {
      if (timer.current !== null) clearTimeout(timer.current);
    },
    [],
  );

  const change = (questionId: string, answer: Answer) => {
    const next = { ...answers, [questionId]: answer };
    setAnswers(next);
    setSaveState("dirty");
    // Sauvegarde automatique, espacée : le serveur refuse plus d'une sauvegarde toutes les 5 s (R15).
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      draft.mutate(next);
    }, DRAFT_DELAY_MS);
  };
  const flush = () => {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
  };
  const goTo = (next: number) => {
    setIndex(next);
    setConfirming(false);
    // Le lecteur d'écran annonce la nouvelle question ; le doigt la trouve en haut de l'écran.
    requestAnimationFrame(() => questionHeading.current?.focus());
  };
  const question = data.questions[index];
  const total = data.questions.length;
  const unanswered = data.questions.filter((entry) => !isAnswered(answers[entry.id])).length;

  return (
    <>
      <div className="focus-bar">
        <div className="focus-bar-inner">
          <div>
            <p className="eyebrow">Devoir · à rendre avant {weekdayHour(data.dueAt)}</p>
            <h1>{data.title}</h1>
          </div>
          <div className="focus-status">
            <p className="saved-state" role="status">
              {saveState === "saved" && (
                <>
                  <Icon icon={Check} /> Enregistré
                </>
              )}
              {saveState === "saving" && "Enregistrement…"}
              {saveState === "dirty" && "Pas encore enregistré…"}
            </p>
            <Button
              variant="quiet"
              disabled={draft.isPending}
              onClick={() => {
                void (async () => {
                  if (saveState !== "saved") {
                    flush();
                    await draft.mutateAsync(answers).catch(() => undefined);
                  }
                  await navigate("/eleve/devoirs");
                })();
              }}
            >
              Arrêter et reprendre plus tard
            </Button>
          </div>
        </div>
      </div>
      <div className="page medium">
        <ol className="question-dots" aria-label="Questions du devoir">
          {data.questions.map((entry, position) => {
            const answered = isAnswered(answers[entry.id]);
            return (
              <li key={entry.id}>
                <button
                  type="button"
                  data-answered={answered && position !== index}
                  aria-current={position === index ? "step" : undefined}
                  aria-label={`Question ${String(position + 1)}${answered ? ", répondue" : ""}`}
                  onClick={() => {
                    goTo(position);
                  }}
                >
                  {position + 1}
                </button>
              </li>
            );
          })}
          <li className="hint" aria-hidden="true">
            Question {index + 1} sur {total}
          </li>
        </ol>
        {question !== undefined && (
          <Card className="question-card" aria-labelledby={`question-${question.id}`}>
            <p className="kicker">
              {KIND_HINTS[question.kind]} · {points(question.points)}
            </p>
            <h2 id={`question-${question.id}`} ref={questionHeading} tabIndex={-1}>
              <span className="visually-hidden">
                Question {index + 1} sur {total} :{" "}
              </span>
              {question.prompt}
            </h2>
            <AnswerField
              key={question.id}
              attempt={data}
              question={question}
              answer={answers[question.id]}
              disabled={submit.isPending}
              onChange={(answer) => {
                change(question.id, answer);
              }}
            />
          </Card>
        )}
        <div className="question-nav">
          {index > 0 ? (
            <Button
              variant="secondary"
              icon={ChevronLeft}
              onClick={() => {
                goTo(index - 1);
              }}
            >
              Question précédente
            </Button>
          ) : (
            <span />
          )}
          {index < total - 1 && (
            <Button
              iconAfter={ChevronRight}
              onClick={() => {
                goTo(index + 1);
              }}
            >
              Question suivante
            </Button>
          )}
        </div>
        <ErrorMessage error={draft.error ?? submit.error} />
        <Card className="dashed" aria-labelledby="rendre">
          {confirming ? (
            <div className="stack-sm" role="group" aria-labelledby="rendre">
              <h2 id="rendre">Tu rends ton devoir ?</h2>
              <p>
                {unanswered > 0
                  ? `Attention : ${plural(unanswered, "question")} ${unanswered > 1 ? "n'ont" : "n'a"} pas encore de réponse. `
                  : ""}
                Après, tu ne pourras plus le modifier.
              </p>
              <div className="actions">
                <Button
                  disabled={submit.isPending}
                  onClick={() => {
                    flush();
                    submit.mutate(answers);
                  }}
                >
                  Oui, rendre mon devoir
                </Button>
                <Button
                  variant="secondary"
                  onClick={() => {
                    setConfirming(false);
                  }}
                >
                  Pas encore
                </Button>
              </div>
            </div>
          ) : (
            <div className="hand-in">
              <div>
                <h2 id="rendre">Quand tu as tout fini</h2>
                <p>Après avoir rendu ton devoir, tu ne pourras plus le modifier. Ton tuteur le corrigera.</p>
              </div>
              <Button
                variant="secondary"
                onClick={() => {
                  setConfirming(true);
                }}
              >
                Rendre mon devoir
              </Button>
            </div>
          )}
        </Card>
      </div>
    </>
  );
}

/** Ce que l'élève a répondu, en texte (copie rendue ou corrigée). */
function answerSummary(question: Question, answer: Answer | undefined): string | null {
  if (answer === undefined || !isAnswered(answer)) return "Pas de réponse";
  switch (answer.kind) {
    case "mcq":
      return question.kind === "mcq"
        ? question.options
            .filter((option) => answer.optionIds.includes(option.id))
            .map((option) => option.text)
            .join(", ")
        : null;
    case "numeric":
      return `${answer.value} ${answer.unit}`;
    case "short_text":
      return answer.text;
    case "notebook":
      return null;
  }
}

/** Réponse attendue et explication : seulement après la révélation du corrigé (R5, verdict L3 R-1). */
function expectedOf(
  attempt: LearnerAttempt,
  question: Question,
): { expected: string | null; explanation: string | null } {
  const key = attempt.answerKey?.questions.find((candidate) => candidate.questionId === question.id);
  if (key === undefined) return { expected: null, explanation: null };
  const solution = key.expected;
  const expected =
    solution.kind === "mcq"
      ? (question.kind === "mcq" ? question.options : [])
          .filter((option) => solution.correctOptionIds.includes(option.id))
          .map((option) => option.text)
          .join(", ")
      : solution.kind === "numeric"
        ? `${solution.expected.replace(".", ",")} ${solution.unit}`
        : solution.modelAnswer;
  return { expected: expected === "" ? null : expected, explanation: key.explanation };
}

/**
 * Copie rendue ou corrigée (maquette Eleve-Copie) : la note en tampon, « Réussie » ou « À revoir »
 * (jamais de rouge sur une note, charte §1), le mot du tuteur, et le corrigé verrouillé expliqué.
 */
function AttemptResult({ data, learner }: { readonly data: LearnerAttempt; readonly learner: boolean }) {
  const correction = data.correction;
  const resultOf = (questionId: string) =>
    correction?.questions.find((entry) => entry.questionId === questionId);
  const succeeded = data.questions.filter((question) => {
    const result = resultOf(question.id);
    return result !== undefined && result.earned >= question.points;
  }).length;
  const total = data.questions.length;
  const comments = (correction?.questions ?? []).filter(
    (entry) => entry.comment !== null && entry.comment !== "",
  );

  return (
    <div className="page medium">
      <p>
        <Link to={learner ? "/eleve/devoirs" : "/famille"}>
          {learner ? "Retour à mes devoirs" : "Retour au suivi"}
        </Link>
      </p>
      <div className="stack">
        <Card className="result-head">
          {correction !== null && (
            <div
              className="grade-stamp"
              role="img"
              aria-label={`Note : ${numberFr(correction.grade)} sur 20`}
            >
              <strong aria-hidden="true">{numberFr(correction.grade)}</strong>
              <span aria-hidden="true">sur 20</span>
            </div>
          )}
          <div className="result-body">
            <p className="kicker">
              {data.submittedAt === null ? "Devoir" : `Rendu le ${longDate(data.submittedAt)}`}
              {data.number > 1 ? ` · essai ${String(data.number)}` : ""}
            </p>
            <h1>{data.title}</h1>
            {correction === null ? (
              <p>
                {learner
                  ? "Ton devoir est rendu. Ton tuteur va le corriger : ta note apparaîtra ici."
                  : "Copie rendue, en attente de correction."}
              </p>
            ) : (
              <p>
                {learner
                  ? succeeded * 2 >= total
                    ? `Bravo, tu as réussi ${plural(succeeded, "question")} sur ${String(total)}.`
                    : `Tu as réussi ${plural(succeeded, "question")} sur ${String(total)}. Regarde les questions « À revoir » avec ton tuteur.`
                  : `${plural(succeeded, "question réussie", "questions réussies")} sur ${String(total)}.`}
              </p>
            )}
            {data.late && (
              <Pill tone="neutral" icon={Clock}>
                Rendu en retard
              </Pill>
            )}
          </div>
        </Card>

        <section aria-labelledby="par-question" className="stack-sm">
          <h2 id="par-question">Question par question</h2>
          <ol className="boxed-rows question-results">
            {data.questions.map((question, position) => {
              const result = resultOf(question.id);
              const { expected, explanation } = expectedOf(data, question);
              const summary = answerSummary(question, data.answers[question.id]);
              return (
                <li key={question.id}>
                  {result !== undefined &&
                    (result.earned >= question.points ? (
                      <Pill tone="done" icon={Check}>
                        Réussie
                      </Pill>
                    ) : (
                      <Pill tone="todo" icon={RotateCcw}>
                        À revoir
                      </Pill>
                    ))}
                  <span>
                    {position + 1}. {question.prompt}
                  </span>
                  <span className="score">
                    {result === undefined
                      ? points(question.points)
                      : `${numberFr(result.earned)} / ${numberFr(question.points)}`}
                  </span>
                  <div
                    className="correction"
                    aria-label={`Correction de la question ${String(position + 1)}`}
                  >
                    {summary !== null && (
                      <p>
                        {learner ? "Ta réponse" : "Sa réponse"} : {summary}
                      </p>
                    )}
                    {expected !== null && <p>Réponse attendue : {expected}</p>}
                    {explanation !== null && <p>{explanation}</p>}
                    {result?.comment !== null && result?.comment !== undefined && (
                      <p>
                        <strong>Le mot {learner ? "de ton" : "du"} tuteur :</strong> {result.comment}
                      </p>
                    )}
                    {question.kind === "notebook" && (
                      <AnswerField
                        attempt={data}
                        question={question}
                        answer={data.answers[question.id]}
                        disabled
                        onChange={() => undefined}
                      />
                    )}
                  </div>
                </li>
              );
            })}
          </ol>
        </section>

        {comments.length === 0 && correction !== null && learner && (
          <p className="hint">Ton tuteur n'a pas laissé de mot sur cette copie.</p>
        )}

        {correction !== null && data.answerKey === null && (
          <Notice tone="locked" icon={Lock}>
            <p>
              Le corrigé sera visible après la date limite, {longDateTime(data.dueAt)}, pour que chacun ait le
              temps de finir.
            </p>
          </Notice>
        )}
      </div>
    </div>
  );
}

/** Une copie : à remplir en mode focus tant qu'elle est en brouillon, puis figée ; corrigé après publication. */
export function AttemptPage() {
  const { attemptId = "" } = useParams();
  const me = useMe();
  const attempt = useQuery({ queryKey: ["attempt", attemptId], queryFn: () => fetchAttempt(attemptId) });
  if (attempt.isPending) return <p role="status">Chargement…</p>;
  if (attempt.isError)
    return (
      <div className="page narrow">
        <ErrorMessage error={attempt.error} />
      </div>
    );
  const learner = me.data?.kind === "learner";
  if (attempt.data.status === "draft" && learner) return <FocusAttempt data={attempt.data} />;
  return <AttemptResult data={attempt.data} learner={learner} />;
}
