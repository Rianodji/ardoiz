import { useMutation, useQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "react-router";
import { fetchMyAssignments, startAttempt } from "../api/assessment";
import { fetchLearnerProgramme } from "../api/curriculum";
import { fetchProgress, type LearnerProgress } from "../api/progress";
import { fetchAgenda, type Occurrence } from "../api/scheduling";
import { useMe } from "../auth/session";
import { ErrorMessage } from "../components/ErrorMessage";
import { BADGE_LABELS, LEARNER_LEVEL_LABELS, LEVEL_STEPS } from "../components/ProgressViews";
import { Button, ButtonLink, Card, Icon, Notice, PageHeader, Pill, ProgressBar } from "../ui";
import {
  hourFr,
  longDate,
  longDateTime,
  NBSP,
  numberFr,
  plural,
  todayTitle,
  weekdayHour,
} from "../ui/format";
import {
  AppWindow,
  Award,
  BookText,
  Calendar,
  ChartColumn,
  Check,
  ClipboardCheck,
  Clock,
  Lock,
  Star,
  TrendingUp,
  Triangle,
  Video,
} from "../ui/icons";
import { JoinButton, parisToday, useNow } from "./AgendaPages";

type Assignment = Awaited<ReturnType<typeof fetchMyAssignments>>["assignments"][number];

/** Pastille d'un devoir, du point de vue de l'élève : toujours un mot et une icône (charte §1). */
export function AssignmentPill({
  assignment,
  now,
}: {
  readonly assignment: Assignment;
  readonly now: number;
}) {
  switch (assignment.state) {
    case "upcoming":
      // L8, correction 2 : un devoir « bientôt » dit quand il s'ouvre.
      return (
        <Pill tone="soon" icon={Calendar}>
          Bientôt : s'ouvre le {longDateTime(assignment.opensAt)}
        </Pill>
      );
    case "open":
    case "in_progress": {
      const late = Date.parse(assignment.dueAt) <= now;
      return (
        <Pill tone="todo" icon={Clock}>
          {late
            ? "En retard : tu peux encore le rendre"
            : `${assignment.state === "in_progress" ? "Commencé · " : ""}À rendre avant ${weekdayHour(assignment.dueAt)}`}
        </Pill>
      );
    }
    case "submitted":
      return (
        <Pill tone="done" icon={Check}>
          Rendu
        </Pill>
      );
    case "published":
      return (
        <Pill tone="done" icon={Check}>
          Corrigé
        </Pill>
      );
    case "closed":
      return (
        <Pill tone="closed" icon={Lock}>
          Fermé
        </Pill>
      );
    default:
      return null;
  }
}

const isToDo = (assignment: Assignment) => assignment.state === "open" || assignment.state === "in_progress";
const byDue = (a: Assignment, b: Assignment) => Date.parse(a.dueAt) - Date.parse(b.dueAt);

/** Commencer ou reprendre un devoir : la copie est créée par le serveur, puis l'élève y entre. */
function useStart() {
  const navigate = useNavigate();
  return useMutation({
    mutationFn: startAttempt,
    onSuccess: (attempt) => navigate(`/copie/${attempt.attemptId}`),
  });
}

/** La chose importante de l'écran (charte §1) : le prochain devoir à rendre. */
function NowCard({
  assignments,
  now,
}: {
  readonly assignments: readonly Assignment[];
  readonly now: number;
}) {
  const start = useStart();
  const next = assignments.filter(isToDo).sort(byDue)[0];
  if (next === undefined) {
    return (
      <Card className="todo-card" aria-labelledby="a-faire">
        <p className="kicker" id="a-faire">
          À faire maintenant
        </p>
        <h2>Rien à rendre pour l'instant</h2>
        <p>Tu es à jour. Tu peux relire un cours ou regarder tes progrès.</p>
        <div className="actions">
          <ButtonLink to="/eleve/cours" variant="secondary" icon={BookText}>
            Voir mes cours
          </ButtonLink>
        </div>
      </Card>
    );
  }
  return (
    <Card className="todo-card" aria-labelledby="a-faire">
      <h2 className="visually-hidden" id="a-faire">
        À faire maintenant
      </h2>
      <AssignmentPill assignment={next} now={now} />
      <h3 className="todo-title">{next.title}</h3>
      <p>Tu peux t'arrêter et reprendre plus tard : ton travail est gardé.</p>
      <ErrorMessage error={start.error} />
      <div className="actions">
        <Button
          disabled={start.isPending}
          onClick={() => {
            start.mutate(next.assignmentId);
          }}
        >
          {next.state === "open" ? "Commencer le devoir" : "Reprendre le devoir"}
        </Button>
        <ButtonLink to="/eleve/devoirs" variant="secondary">
          Voir tous mes devoirs
        </ButtonLink>
      </div>
    </Card>
  );
}

/** Prochaine séance : le bouton « Rejoindre » ne s'active que dans la fenêtre (R9). */
function NextSessionCard({ now }: { readonly now: number }) {
  const today = parisToday();
  const agenda = useQuery({ queryKey: ["agenda", today, 14], queryFn: () => fetchAgenda(today, 14) });
  const next = agenda.data?.occurrences
    .filter((occurrence) => occurrence.status === "scheduled" && Date.parse(occurrence.endsAt) > now)
    .sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt))[0];
  return (
    <Card aria-labelledby="prochaine-seance">
      <p className="kicker" id="prochaine-seance">
        <Icon icon={Video} /> Prochaine séance
      </p>
      <ErrorMessage error={agenda.error} />
      {next === undefined ? (
        <p>{agenda.isPending ? "Chargement…" : "Pas de séance prévue dans les deux semaines."}</p>
      ) : (
        <SessionSummary occurrence={next} now={now} />
      )}
    </Card>
  );
}

function SessionSummary({ occurrence, now }: { readonly occurrence: Occurrence; readonly now: number }) {
  const minutes = Math.round((Date.parse(occurrence.endsAt) - Date.parse(occurrence.startsAt)) / 60_000);
  const day = longDate(occurrence.startsAt);
  return (
    <>
      <h3>
        {day.charAt(0).toUpperCase() + day.slice(1)} à{NBSP}
        {hourFr(occurrence.startsAt)}
      </h3>
      <p className="hint">
        {occurrence.title} ·{" "}
        {minutes >= 60 && minutes % 60 === 0 ? plural(minutes / 60, "heure") : `${String(minutes)} minutes`}
      </p>
      <JoinButton occurrence={occurrence} now={now} />
    </>
  );
}

/** Points et niveau, sur l'ardoise : les réussites en jaune soleil (charte §1). */
function PointsCard({
  progress,
  compact,
}: {
  readonly progress: LearnerProgress;
  readonly compact: boolean;
}) {
  const span = progress.nextLevelXp - progress.currentLevelXp;
  const done = progress.xp - progress.currentLevelXp;
  const last = [...progress.badges].sort((a, b) => Date.parse(b.awardedAt) - Date.parse(a.awardedAt))[0];
  return (
    <Card className="dark" aria-labelledby="mes-points">
      {compact ? <h2 id="mes-points">Mes progrès</h2> : <p id="mes-points">Niveau {progress.level}</p>}
      <p className="xp-line">
        <span className="xp-number">{progress.xp}</span>
        <span>points{compact ? ` · niveau ${String(progress.level)}` : ""}</span>
      </p>
      <ProgressBar value={done} max={span} label={`Vers le niveau ${String(progress.level + 1)}`} />
      <p className="hint">
        Encore {progress.nextLevelXp - progress.xp} points pour le niveau {progress.level + 1}.
      </p>
      {compact && last !== undefined && (
        <p>
          <Icon icon={Award} /> Dernier badge : {BADGE_LABELS[last.badge]?.title ?? last.badge}
        </p>
      )}
      {!compact && (
        <p className="hint">
          Tu gagnes des points en finissant un cours, en rendant un devoir à l'heure et en venant aux séances.
        </p>
      )}
    </Card>
  );
}

/** Une carte par cours : son titre, son module, et s'il est terminé. */
function LessonCard({
  lesson,
  moduleTitle,
}: {
  readonly lesson: { id: string; title: string; completedAt: string | null };
  readonly moduleTitle: string;
}) {
  return (
    <li className="card lesson-card">
      {lesson.completedAt === null ? (
        <Pill tone="soon" icon={BookText}>
          À lire
        </Pill>
      ) : (
        <Pill tone="done" icon={Check}>
          Terminé
        </Pill>
      )}
      <h3>
        <Link to={`/cours/${lesson.id}`}>{lesson.title}</Link>
      </h3>
      <p>{moduleTitle}</p>
    </li>
  );
}

function useLearnerData(learnerId: string) {
  return {
    assignments: useQuery({ queryKey: ["my-assignments"], queryFn: fetchMyAssignments }),
    progress: useQuery({ queryKey: ["progress", learnerId], queryFn: () => fetchProgress(learnerId) }),
    programme: useQuery({
      queryKey: ["learner-programme", learnerId],
      queryFn: () => fetchLearnerProgramme(learnerId),
    }),
  };
}

const flatLessons = (programme: Awaited<ReturnType<typeof fetchLearnerProgramme>>) =>
  programme.subjects.flatMap((subject) =>
    subject.modules.flatMap((module) =>
      module.lessons.map((lesson) => ({ lesson, moduleTitle: module.title })),
    ),
  );

/**
 * Accueil de l'élève (maquette Eleve-Accueil) : d'abord ce qu'il doit faire maintenant, puis sa
 * prochaine séance, ses cours et ses progrès. Jamais de classement (R17).
 */
export function LearnerHomePage() {
  const me = useMe();
  const now = useNow();
  const learnerId = me.data?.id ?? "";
  const { assignments, progress, programme } = useLearnerData(learnerId);
  const lessons = programme.data === undefined ? [] : flatLessons(programme.data);
  const shown = [...lessons]
    .sort((a, b) => Number(a.lesson.completedAt !== null) - Number(b.lesson.completedAt !== null))
    .slice(0, 3);
  const streak = progress.data?.streak.current ?? 0;
  return (
    <>
      <div className="seyes">
        <div className="seyes-inner">
          <div>
            <p className="eyebrow">{todayTitle(now)}</p>
            <h1>Bonjour {me.data?.name ?? ""}</h1>
          </div>
          {streak > 0 && (
            <p className="streak-badge">
              <Icon icon={Star} /> Série de {plural(streak, "semaine")}
            </p>
          )}
        </div>
      </div>
      <div className="page">
        <div className="grid-main-side">
          <div className="stack">
            <ErrorMessage error={assignments.error} />
            {assignments.data !== undefined && (
              <NowCard assignments={assignments.data.assignments} now={now} />
            )}
            <section aria-labelledby="mes-cours">
              <div className="section-head">
                <h2 id="mes-cours">Mes cours</h2>
                <Link to="/eleve/cours">Tous mes cours</Link>
              </div>
              <ErrorMessage error={programme.error} />
              {programme.data !== undefined && shown.length === 0 && (
                <p>Ton tuteur n'a pas encore ouvert de cours pour toi. Ils apparaîtront ici.</p>
              )}
              <ul className="cards-row plain">
                {shown.map(({ lesson, moduleTitle }) => (
                  <LessonCard key={lesson.id} lesson={lesson} moduleTitle={moduleTitle} />
                ))}
              </ul>
            </section>
          </div>
          <div className="stack">
            <NextSessionCard now={now} />
            <ErrorMessage error={progress.error} />
            {progress.data !== undefined && <PointsCard progress={progress.data} compact />}
          </div>
        </div>
      </div>
    </>
  );
}

/** Mes cours : matière par matière, module par module ; ce qui est terminé est marqué. */
export function LearnerLessonsPage() {
  const me = useMe();
  const programme = useQuery({
    queryKey: ["learner-programme", me.data?.id ?? ""],
    queryFn: () => fetchLearnerProgramme(me.data?.id ?? ""),
  });
  return (
    <div className="page">
      <PageHeader title="Mes cours" lead="Les cours que ton tuteur a ouverts pour toi." />
      {programme.isPending && <p role="status">Chargement…</p>}
      <ErrorMessage error={programme.error} />
      {programme.data?.subjects.length === 0 && (
        <Notice icon={BookText}>
          Ton tuteur n'a pas encore ouvert de cours pour toi. Ils apparaîtront ici.
        </Notice>
      )}
      <div className="stack">
        {programme.data?.subjects.map((subject) => (
          <section key={subject.id} aria-labelledby={`matiere-${subject.id}`} className="stack-sm">
            <h2 id={`matiere-${subject.id}`}>{subject.name}</h2>
            {subject.modules.map((module) => (
              <div key={module.id} className="stack-sm">
                <h3>{module.title}</h3>
                <ul className="cards-row plain">
                  {module.lessons.map((lesson) => (
                    <LessonCard key={lesson.id} lesson={lesson} moduleTitle={subject.name} />
                  ))}
                </ul>
              </div>
            ))}
          </section>
        ))}
      </div>
    </div>
  );
}

function AssignmentRow({ assignment, now }: { readonly assignment: Assignment; readonly now: number }) {
  const start = useStart();
  return (
    <li>
      <div className="row-main">
        <p className="row-title">{assignment.title}</p>
        <p className="row-meta">
          {assignment.state === "upcoming"
            ? `S'ouvre le ${longDateTime(assignment.opensAt)}, à rendre avant le ${longDateTime(assignment.dueAt)}.`
            : `À rendre avant le ${longDateTime(assignment.dueAt)}.`}
        </p>
        <ErrorMessage error={start.error} />
      </div>
      <div className="row-side">
        <AssignmentPill assignment={assignment} now={now} />
        {assignment.grade !== null && <strong className="num">{numberFr(assignment.grade)} / 20</strong>}
        {isToDo(assignment) && (
          <Button
            disabled={start.isPending}
            onClick={() => {
              start.mutate(assignment.assignmentId);
            }}
          >
            {assignment.state === "open" ? "Commencer" : "Reprendre"}
          </Button>
        )}
        {(assignment.state === "submitted" || assignment.state === "published") &&
          assignment.currentAttemptId !== null && (
            <ButtonLink to={`/copie/${assignment.currentAttemptId}`} variant="secondary">
              Voir ma copie
            </ButtonLink>
          )}
        {assignment.state === "submitted" && assignment.attemptsLeft > 0 && (
          <Button
            variant="secondary"
            disabled={start.isPending}
            onClick={() => {
              start.mutate(assignment.assignmentId);
            }}
          >
            Nouvel essai
          </Button>
        )}
      </div>
    </li>
  );
}

/** Mes devoirs : à faire, bientôt, rendus et corrigés, fermés. La note n'apparaît qu'après publication (R5). */
export function LearnerAssignmentsPage() {
  const now = useNow();
  const assignments = useQuery({ queryKey: ["my-assignments"], queryFn: fetchMyAssignments });
  const all = [...(assignments.data?.assignments ?? [])].sort(byDue);
  const groups: ReadonlyArray<{ title: string; items: Assignment[] }> = [
    { title: "À faire", items: all.filter(isToDo) },
    { title: "Bientôt", items: all.filter((entry) => entry.state === "upcoming") },
    {
      title: "Rendus et corrigés",
      items: all.filter((entry) => entry.state === "submitted" || entry.state === "published").reverse(),
    },
    { title: "Fermés", items: all.filter((entry) => entry.state === "closed") },
  ];
  return (
    <div className="page medium">
      <PageHeader title="Mes devoirs" />
      {assignments.isPending && <p role="status">Chargement…</p>}
      <ErrorMessage error={assignments.error} />
      {assignments.data?.assignments.length === 0 && (
        <Notice icon={ClipboardCheck}>Aucun devoir pour le moment.</Notice>
      )}
      <div className="stack">
        {groups
          .filter((group) => group.items.length > 0)
          .map((group) => (
            <Card key={group.title} aria-label={group.title}>
              <h2>{group.title}</h2>
              <ul className="rows">
                {group.items.map((assignment) => (
                  <AssignmentRow key={assignment.assignmentId} assignment={assignment} now={now} />
                ))}
              </ul>
            </Card>
          ))}
      </div>
    </div>
  );
}

const BADGE_ICONS = {
  "first-step": Award,
  geometer: Triangle,
  "units-master": ChartColumn,
  assiduous: AppWindow,
  persevering: TrendingUp,
} as const;

/** Mes progrès (maquette Eleve-Progres) : points, série, badges obtenus et à gagner, compétences. */
export function LearnerProgressPage() {
  const me = useMe();
  const learnerId = me.data?.id ?? "";
  const progress = useQuery({ queryKey: ["progress", learnerId], queryFn: () => fetchProgress(learnerId) });
  const data = progress.data;
  return (
    <div className="page">
      <PageHeader title="Mes progrès" />
      {progress.isPending && <p role="status">Chargement…</p>}
      <ErrorMessage error={progress.error} />
      {data !== undefined && (
        <div className="stack">
          <div className="grid-two">
            <PointsCard progress={data} compact={false} />
            <StreakCard streak={data.streak} />
          </div>
          <section aria-labelledby="mes-badges">
            <h2 id="mes-badges">Mes badges</h2>
            <ul className="badge-grid">
              {Object.entries(BADGE_LABELS).map(([badge, label]) => {
                const earned = data.badges.find((entry) => entry.badge === badge);
                const icon = BADGE_ICONS[badge as keyof typeof BADGE_ICONS];
                return (
                  <li key={badge} data-earned={earned !== undefined}>
                    <Icon icon={icon} />
                    <strong>{label.title}</strong>
                    <span>
                      {earned === undefined ? label.hint : `Gagné le ${longDate(earned.awardedAt)}`}
                    </span>
                    <span className="visually-hidden">
                      {earned === undefined ? "Pas encore gagné." : "Gagné."}
                    </span>
                  </li>
                );
              })}
            </ul>
          </section>
          <SkillsCard progress={data} />
        </div>
      )}
    </div>
  );
}

/**
 * Série hebdomadaire (R17) : une case par semaine d'affilée, la semaine en cours entourée ; une
 * semaine de pause est une case en pointillé. Aucune pression : rien ne défile, rien ne clignote.
 */
function StreakCard({ streak }: { readonly streak: LearnerProgress["streak"] }) {
  const shown = Math.min(streak.current, 8);
  return (
    <Card aria-labelledby="ma-serie">
      <h2 id="ma-serie">Ma série : {plural(streak.current, "semaine")}</h2>
      {shown > 0 && (
        <ul className="streak-weeks" aria-hidden="true">
          {Array.from({ length: shown }, (_, index) => (
            <li key={index} data-week={index === shown - 1 && !streak.paused ? "current" : "active"} />
          ))}
          {streak.paused && <li data-week="pause" />}
        </ul>
      )}
      {streak.paused && <p>Cette semaine est en pause : ta série continue.</p>}
      <p className="hint">
        Une semaine sans travail met ta série en pause, sans l'effacer (une fois par mois). Ta meilleure série
        : {plural(streak.best, "semaine")}.
      </p>
    </Card>
  );
}

/** Compétences avec les mots de l'enfant (charte §6) : une jauge de 4 segments et un mot. */
export function SkillsCard({ progress }: { readonly progress: LearnerProgress }) {
  const subjects = [...new Set(progress.competencies.map((competency) => competency.subjectName))];
  const assessed = progress.competencies.filter((competency) => competency.level !== "not_assessed");
  return (
    <Card aria-labelledby="mes-competences">
      <h2 id="mes-competences">Ce que je sais faire</h2>
      {assessed.length === 0 && <p>Tes compétences apparaîtront ici après tes premiers devoirs corrigés.</p>}
      {subjects.map((subject) => {
        const items = assessed.filter((competency) => competency.subjectName === subject);
        if (items.length === 0) return null;
        return (
          <div key={subject}>
            <h3>En {subject.toLowerCase()}</h3>
            <ul className="skill-rows">
              {items.map((competency) => (
                <li key={competency.competencyId}>
                  <span className="skill-label">{competency.label}</span>
                  <span className="skill-meter" aria-hidden="true">
                    {[1, 2, 3, 4].map((step) => (
                      <span key={step} data-on={step <= (LEVEL_STEPS[competency.level] ?? 0)} />
                    ))}
                  </span>
                  <span className="skill-level">{LEARNER_LEVEL_LABELS[competency.level]}</span>
                  {competency.adjustment !== null && (
                    <span className="hint">
                      Ton tuteur a noté : « {competency.adjustment.justification} »
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </div>
        );
      })}
      <p className="hint">
        Pas encore vu · On commence · En bonne voie · Acquise · Au-delà : ces mots remplacent les niveaux
        officiels (non évaluée, non acquise, en cours, acquise, dépassée).
      </p>
    </Card>
  );
}
