import { Link } from "react-router";
import type { LearnerProgress } from "../api/progress";
import { Pill, ProgressBar, TableBox } from "../ui";
import { longDate, numberFr, plural, shortDate } from "../ui/format";
import { Award } from "../ui/icons";

/**
 * Vues de la progression d'UN élève (R17) : ses points, sa série, ses badges, ses compétences, ses notes.
 * Jamais de classement ni de comparaison avec un autre élève, jamais de pénalité affichée.
 */

/** Niveaux officiels (big picture §8), pour l'adulte. */
export const LEVEL_LABELS: Readonly<Record<string, string>> = {
  not_assessed: "Pas encore évaluée",
  not_acquired: "Non acquise",
  in_progress: "En cours d'acquisition",
  acquired: "Acquise",
  exceeded: "Dépassée",
};

/** Les mêmes niveaux, reformulés pour l'enfant (charte §6). */
export const LEARNER_LEVEL_LABELS: Readonly<Record<string, string>> = {
  not_assessed: "Pas encore vu",
  not_acquired: "On commence",
  in_progress: "En bonne voie",
  acquired: "Acquise",
  exceeded: "Au-delà",
};

/** Segments allumés sur la jauge de 4 : la jauge double toujours le mot, jamais seule (charte §1). */
export const LEVEL_STEPS: Readonly<Record<string, number>> = {
  not_assessed: 0,
  not_acquired: 1,
  in_progress: 2,
  acquired: 3,
  exceeded: 4,
};

export const BADGE_LABELS: Readonly<Record<string, { title: string; hint: string }>> = {
  "first-step": { title: "Premier pas", hint: "Rendre sa première copie" },
  geometer: { title: "Géomètre", hint: "Acquérir 5 compétences de géométrie" },
  "units-master": { title: "Maître des unités", hint: "10 conversions réussies de suite" },
  assiduous: { title: "Assidu", hint: "Une série de 4 semaines" },
  persevering: { title: "Persévérant", hint: "Faire passer une compétence de « non acquise » à « acquise »" },
};

/** Points, niveau, série et badges, pour un adulte (tuteur, parent). */
export function ProgressSummary({ progress }: { readonly progress: LearnerProgress }) {
  const span = progress.nextLevelXp - progress.currentLevelXp;
  const done = progress.xp - progress.currentLevelXp;
  return (
    <div className="stack-sm">
      <p>
        <strong>Niveau {progress.level}</strong> · {progress.xp} points
      </p>
      <ProgressBar
        value={done}
        max={span}
        label={`Vers le niveau ${String(progress.level + 1)}`}
        tone="green"
      />
      <p className="hint">
        {progress.nextLevelXp - progress.xp} points avant le niveau {progress.level + 1}
      </p>
      <p>
        Série : {plural(progress.streak.current, "semaine")} d'activité
        {progress.streak.paused && " (semaine en pause, la série continue)"} · meilleure série :{" "}
        {progress.streak.best}
      </p>
      <Badges progress={progress} />
    </div>
  );
}

export function Badges({ progress }: { readonly progress: LearnerProgress }) {
  if (progress.badges.length === 0) return <p className="hint">Aucun badge pour l'instant.</p>;
  return (
    <ul className="actions plain" aria-label="Badges obtenus">
      {progress.badges.map((entry) => (
        <li key={entry.badge}>
          <Pill tone="points" icon={Award}>
            {BADGE_LABELS[entry.badge]?.title ?? entry.badge}
          </Pill>{" "}
          <span className="hint">le {longDate(entry.awardedAt)}</span>
        </li>
      ))}
    </ul>
  );
}

/** Compétences évaluées, groupées par matière, avec l'ajustement éventuel du tuteur et sa justification. */
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
          <ul className="skill-rows">
            {assessed
              .filter((competency) => competency.subjectName === subject)
              .map((competency) => (
                <li key={competency.competencyId} data-level={competency.level}>
                  <span className="skill-label">
                    <code>{competency.code}</code> {competency.label}
                  </span>
                  <span className="skill-level">{LEVEL_LABELS[competency.level]}</span>
                  {competency.adjustment !== null && (
                    <span className="hint">
                      Ajusté par le tuteur : « {competency.adjustment.justification} »
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

/** Nombre de compétences par niveau, pour une matière (synthèse du parent). */
export function competencyCounts(progress: LearnerProgress, subjectName?: string) {
  const items = progress.competencies.filter(
    (competency) => subjectName === undefined || competency.subjectName === subjectName,
  );
  const count = (...levels: string[]) =>
    items.filter((competency) => levels.includes(competency.level)).length;
  return {
    acquired: count("acquired", "exceeded"),
    inProgress: count("in_progress", "not_acquired"),
    notAssessed: count("not_assessed"),
  };
}

const WIDTH = 640;
const HEIGHT = 220;
const LEFT = 40;
const RIGHT = 24;
const TOP = 16;
const BOTTOM = 36;

/**
 * Évolution des notes d'une matière, en SVG construit par React (aucune bibliothèque, aucun HTML
 * injecté, compatible avec la CSP). Le tableau qui suit donne les mêmes valeurs, avec le lien vers
 * chaque copie corrigée (charte §6 : graphique suivi de son tableau accessible).
 */
export function GradeChart({ subject }: { readonly subject: LearnerProgress["subjects"][number] }) {
  const grades = subject.grades;
  const x = (index: number) =>
    grades.length === 1
      ? (LEFT + WIDTH - RIGHT) / 2
      : LEFT + (index * (WIDTH - LEFT - RIGHT)) / (grades.length - 1);
  const y = (grade: number) => TOP + (1 - grade / 20) * (HEIGHT - TOP - BOTTOM);
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
            <line x1={LEFT} x2={WIDTH - RIGHT} y1={y(tick)} y2={y(tick)} className="grid" />
            <text x={8} y={y(tick) + 4} className="axis">
              {tick}
            </text>
          </g>
        ))}
        {grades.length > 1 && <polyline points={points} className="line" />}
        {grades.map((entry, index) => (
          <g key={entry.attemptId}>
            <circle cx={x(index)} cy={y(entry.grade)} r={6} className="dot" />
            <text x={x(index)} y={HEIGHT - 10} textAnchor="middle" className="axis">
              {shortDate(entry.publishedAt)}
            </text>
          </g>
        ))}
      </svg>
      <figcaption className="hint">
        {subject.name} — moyenne : {subject.average === null ? "—" : `${numberFr(subject.average)} / 20`}
      </figcaption>
      <TableBox label={`Notes de ${subject.name}, en tableau`}>
        <caption className="visually-hidden">Notes de {subject.name}</caption>
        <thead>
          <tr>
            <th scope="col">Copie</th>
            <th scope="col">Date</th>
            <th scope="col">Note</th>
            <th scope="col">
              <span className="visually-hidden">Lien</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {[...grades].reverse().map((entry) => (
            <tr key={entry.attemptId}>
              <td>{entry.title}</td>
              <td>{shortDate(entry.publishedAt)}</td>
              <td className="num">
                <strong>{numberFr(entry.grade)} / 20</strong>
              </td>
              <td>
                <Link to={`/copie/${entry.attemptId}`} aria-label={`Voir la copie : ${entry.title}`}>
                  Voir la copie
                </Link>
              </td>
            </tr>
          ))}
        </tbody>
      </TableBox>
    </figure>
  );
}
