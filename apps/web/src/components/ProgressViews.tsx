import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router";
import { fetchLearnerAssignments, fetchProgress, type LearnerProgress } from "../api/progress";
import { ErrorMessage } from "./ErrorMessage";

/**
 * Vues de la progression d'UN élève (R17) : ses points, sa série, ses badges, ses compétences, ses notes.
 * Jamais de classement ni de comparaison avec un autre élève, jamais de pénalité affichée.
 */
export const LEVEL_LABELS: Readonly<Record<string, string>> = {
  not_assessed: "Pas encore évaluée",
  not_acquired: "Non acquise",
  in_progress: "En cours d'acquisition",
  acquired: "Acquise",
  exceeded: "Dépassée",
};

export const BADGE_LABELS: Readonly<Record<string, { title: string; hint: string }>> = {
  "first-step": { title: "Premier pas", hint: "Première copie rendue" },
  geometer: { title: "Géomètre", hint: "5 compétences de géométrie acquises" },
  "units-master": { title: "Maître des unités", hint: "10 conversions réussies d'affilée" },
  assiduous: { title: "Assidu", hint: "Série de 4 semaines" },
  persevering: { title: "Persévérant", hint: "Une compétence passée de non acquise à acquise" },
};

const dateFr = (iso: string) =>
  new Intl.DateTimeFormat("fr-FR", { timeZone: "Europe/Paris", day: "numeric", month: "short" }).format(
    new Date(iso),
  );
const gradeFr = (grade: number) => grade.toLocaleString("fr-FR", { maximumFractionDigits: 2 });

/** Points, niveau, série et badges. */
export function ProgressSummary({
  progress,
  you,
}: {
  readonly progress: LearnerProgress;
  readonly you: boolean;
}) {
  const span = progress.nextLevelXp - progress.currentLevelXp;
  const done = progress.xp - progress.currentLevelXp;
  return (
    <div className="progress-summary">
      <p>
        <strong>Niveau {progress.level}</strong> · {progress.xp} points
      </p>
      <label className="xp-bar">
        <span className="visually-hidden">Vers le niveau {progress.level + 1}</span>
        <progress max={span} value={done} />
        <span className="hint">
          {progress.nextLevelXp - progress.xp} points avant le niveau {progress.level + 1}
        </span>
      </label>
      <p>
        Série : {progress.streak.current} semaine{progress.streak.current > 1 ? "s" : ""} d'activité
        {progress.streak.paused && " (semaine en pause, la série continue)"} · meilleure série :{" "}
        {progress.streak.best}
      </p>
      <h3>{you ? "Mes badges" : "Ses badges"}</h3>
      {progress.badges.length === 0 ? (
        <p className="hint">Aucun badge pour l'instant.</p>
      ) : (
        <ul className="badges">
          {progress.badges.map((entry) => (
            <li key={entry.badge} title={BADGE_LABELS[entry.badge]?.hint}>
              <span aria-hidden="true">🏅</span> {BADGE_LABELS[entry.badge]?.title ?? entry.badge}{" "}
              <span className="hint">({dateFr(entry.awardedAt)})</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Compétences, groupées par matière, avec l'ajustement éventuel du tuteur et sa justification. */
export function CompetencyList({ progress }: { readonly progress: LearnerProgress }) {
  const assessed = progress.competencies.filter(
    (competency) => competency.level !== "not_assessed" || competency.adjustment !== null,
  );
  if (assessed.length === 0) return <p className="hint">Aucune compétence évaluée pour l'instant.</p>;
  const subjects = [...new Set(assessed.map((competency) => competency.subjectName))];
  return (
    <>
      {subjects.map((subject) => (
        <div key={subject}>
          <h4>{subject}</h4>
          <ul className="competencies">
            {assessed
              .filter((competency) => competency.subjectName === subject)
              .map((competency) => (
                <li key={competency.competencyId} data-level={competency.level}>
                  <span>
                    {competency.code} — {competency.label}
                  </span>{" "}
                  <strong>{LEVEL_LABELS[competency.level]}</strong>
                  {competency.adjustment !== null && (
                    <span className="hint">
                      {" "}
                      · ajusté par le tuteur : « {competency.adjustment.justification} »
                    </span>
                  )}
                </li>
              ))}
          </ul>
        </div>
      ))}
    </>
  );
}

const WIDTH = 320;
const HEIGHT = 140;
const PAD = 24;

/**
 * Évolution des notes d'une matière, en SVG construit par React (aucune bibliothèque, aucun HTML
 * injecté, compatible avec la CSP). Le tableau qui suit donne les mêmes valeurs, avec le lien vers chaque copie corrigée.
 */
export function GradeChart({ subject }: { readonly subject: LearnerProgress["subjects"][number] }) {
  const grades = subject.grades;
  const x = (index: number) =>
    grades.length === 1 ? WIDTH / 2 : PAD + (index * (WIDTH - 2 * PAD)) / (grades.length - 1);
  const y = (grade: number) => HEIGHT - PAD - (grade / 20) * (HEIGHT - 2 * PAD);
  const points = grades.map((entry, index) => `${String(x(index))},${String(y(entry.grade))}`).join(" ");
  return (
    <figure className="grade-chart">
      <svg
        viewBox={`0 0 ${String(WIDTH)} ${String(HEIGHT)}`}
        role="img"
        aria-label={`Notes de ${subject.name}`}
      >
        {[0, 10, 20].map((tick) => (
          <g key={tick}>
            <line x1={PAD} x2={WIDTH - PAD} y1={y(tick)} y2={y(tick)} className="grid" />
            <text x={4} y={y(tick) + 4} className="axis">
              {tick}
            </text>
          </g>
        ))}
        {grades.length > 1 && <polyline points={points} className="line" />}
        {grades.map((entry, index) => (
          <circle key={entry.attemptId} cx={x(index)} cy={y(entry.grade)} r={4} className="dot" />
        ))}
      </svg>
      <figcaption>
        {subject.name} — moyenne : {subject.average === null ? "—" : `${gradeFr(subject.average)} / 20`}
      </figcaption>
      <table className="grades-table">
        <caption>Notes de {subject.name}</caption>
        <thead>
          <tr>
            <th scope="col">Épreuve</th>
            <th scope="col">Date</th>
            <th scope="col">Note sur 20</th>
          </tr>
        </thead>
        <tbody>
          {grades.map((entry) => (
            <tr key={entry.attemptId}>
              <td>
                <Link to={`/copie/${entry.attemptId}`}>{entry.title}</Link>
              </td>
              <td>{dateFr(entry.publishedAt)}</td>
              <td>{gradeFr(entry.grade)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}

/** Épreuves à venir et en retard d'un élève (tableau de bord du parent). */
export function UpcomingAssignments({
  learnerId,
  now,
}: {
  readonly learnerId: string;
  readonly now: number;
}) {
  const query = useQuery({
    queryKey: ["learner-assignments", learnerId],
    queryFn: () => fetchLearnerAssignments(learnerId),
  });
  if (query.isPending) return <p role="status">Chargement…</p>;
  if (query.data === undefined) return <ErrorMessage error={query.error} />;
  const pending = query.data.assignments.filter((assignment) =>
    ["upcoming", "open", "in_progress", "closed"].includes(assignment.state),
  );
  const late = pending.filter(
    (assignment) => Date.parse(assignment.dueAt) < now && assignment.state !== "upcoming",
  );
  const upcoming = pending.filter((assignment) => Date.parse(assignment.dueAt) >= now);
  return (
    <>
      <h4>À venir</h4>
      {upcoming.length === 0 ? (
        <p className="hint">Aucune épreuve à venir.</p>
      ) : (
        <ul>
          {upcoming.map((assignment) => (
            <li key={assignment.assignmentId}>
              {assignment.title} — à rendre le {dateFr(assignment.dueAt)}
            </li>
          ))}
        </ul>
      )}
      <h4>En retard</h4>
      {late.length === 0 ? (
        <p className="hint">Aucune épreuve en retard.</p>
      ) : (
        <ul>
          {late.map((assignment) => (
            <li key={assignment.assignmentId}>
              {assignment.title} — attendue le {dateFr(assignment.dueAt)}
              {assignment.state === "closed"
                ? " (non rendue)"
                : assignment.lateAllowed
                  ? " (encore possible)"
                  : ""}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

/** Progression d'un élève, telle que la voient l'élève et ses parents. */
export function LearnerDashboard({ learnerId, you }: { readonly learnerId: string; readonly you: boolean }) {
  const query = useQuery({ queryKey: ["progress", learnerId], queryFn: () => fetchProgress(learnerId) });
  if (query.isPending) return <p role="status">Chargement…</p>;
  if (query.data === undefined) return <ErrorMessage error={query.error} />;
  const progress = query.data;
  return (
    <div className="dashboard">
      <ProgressSummary progress={progress} you={you} />
      <h3>{you ? "Mes compétences" : "Ses compétences"}</h3>
      <CompetencyList progress={progress} />
      <h3>{you ? "Mes notes" : "Ses notes et copies corrigées"}</h3>
      {progress.subjects.length === 0 ? (
        <p className="hint">Aucune note publiée pour l'instant.</p>
      ) : (
        progress.subjects.map((subject) => <GradeChart key={subject.subjectId} subject={subject} />)
      )}
    </div>
  );
}
