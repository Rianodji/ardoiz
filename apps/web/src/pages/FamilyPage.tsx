import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { fetchLearnerProgramme } from "../api/curriculum";
import {
  createLearner,
  fetchMyLearners,
  inviteCoGuardian,
  resetLearnerPassword,
  withdrawConsent,
} from "../api/identity";
import { fetchLearnerAssignments, fetchProgress, type LearnerProgress } from "../api/progress";
import { fetchAgenda } from "../api/scheduling";
import { useMe } from "../auth/session";
import { ConsentForm } from "../components/ConsentForm";
import { ErrorMessage } from "../components/ErrorMessage";
import { Badges, CompetencyList, competencyCounts, GradeChart } from "../components/ProgressViews";
import { useReauth } from "../components/useReauth";
import { Button, Card, Field, Notice, PageHeader, Pill, Stat, Tabs } from "../ui";
import { hourFr, longDate, numberFr, plural, weekdayHour } from "../ui/format";
import { BookText, Calendar, Check, Clock, Lock } from "../ui/icons";
import { Agenda, parisToday, useNow } from "./AgendaPages";
import { PasswordField } from "./LoginPage";

const LEVELS = ["6e", "5e", "4e", "3e"] as const;
const LEARNERS_QUERY = ["learners"] as const;

type Learner = Awaited<ReturnType<typeof fetchMyLearners>>["learners"][number];

/**
 * Espace famille du parent (maquette Parent-Famille) : le suivi de chaque enfant, un onglet par
 * enfant ; la gestion de son compte ; la création d'un compte enfant. Le parent est vouvoyé (charte §7).
 * Un parent ne voit que ses enfants, jamais de comparaison (R2, R17).
 */
export function FamilyPage() {
  const learners = useQuery({ queryKey: LEARNERS_QUERY, queryFn: fetchMyLearners });
  const list = learners.data?.learners ?? [];
  const [selected, setSelected] = useState<string | null>(null);
  const current = list.find((learner) => learner.id === selected) ?? list[0];

  return (
    <div className="page">
      {learners.isPending && <p role="status">Chargement…</p>}
      <ErrorMessage error={learners.error} />
      {learners.data !== undefined && current === undefined && (
        <>
          <PageHeader title="Mes enfants" />
          <Notice icon={BookText}>
            Vous n'avez pas encore créé de compte pour votre enfant. Commencez par le formulaire ci-dessous.
          </Notice>
        </>
      )}
      {current !== undefined && (
        <Tabs
          label="Choisir l'enfant"
          variant="pill"
          head={<h1>Suivi de {current.firstName}</h1>}
          tabs={list.map((learner) => ({
            key: learner.id,
            label: `${learner.firstName} · ${learner.schoolLevel}`,
          }))}
          selected={current.id}
          onSelect={setSelected}
        >
          <ChildPanel
            key={current.id}
            learner={current}
            nameOf={(id) => list.find((learner) => learner.id === id)?.firstName ?? "Enfant"}
          />
        </Tabs>
      )}
      <NewLearner open={learners.data !== undefined && list.length === 0} />
    </div>
  );
}

/** Ce dont la liste des devoirs d'un enfant a besoin (réponse de GET /api/learners/:id/assignments). */
interface ChildAssignment {
  readonly assignmentId: string;
  readonly title: string;
  readonly opensAt: string;
  readonly dueAt: string;
  readonly lateAllowed: boolean;
  readonly state: string;
}

/** Dernière note publiée, toutes matières confondues. */
function lastGrade(progress: LearnerProgress) {
  return progress.subjects
    .flatMap((subject) => subject.grades)
    .sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt))[0];
}

function ChildPanel({
  learner,
  nameOf,
}: {
  readonly learner: Learner;
  readonly nameOf: (id: string) => string;
}) {
  const now = useNow();
  const progress = useQuery({ queryKey: ["progress", learner.id], queryFn: () => fetchProgress(learner.id) });
  const assignments = useQuery({
    queryKey: ["learner-assignments", learner.id],
    queryFn: () => fetchLearnerAssignments(learner.id),
  });
  const today = parisToday();
  const agenda = useQuery({ queryKey: ["agenda", today, 14], queryFn: () => fetchAgenda(today, 14) });
  const data = progress.data;
  const last = data === undefined ? undefined : lastGrade(data);
  const graded = data?.subjects.filter((subject) => subject.grades.length > 0) ?? [];
  const main = graded[0];
  const pending = (assignments.data?.assignments ?? []).filter((assignment) =>
    ["open", "in_progress"].includes(assignment.state),
  );
  const nextDue = [...pending].sort((a, b) => Date.parse(a.dueAt) - Date.parse(b.dueAt))[0];
  const nextSession = agenda.data?.occurrences
    .filter(
      (occurrence) =>
        occurrence.status === "scheduled" &&
        occurrence.participantIds.includes(learner.id) &&
        Date.parse(occurrence.endsAt) > now,
    )
    .sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt))[0];

  return (
    <div className="stack">
      {learner.status === "disabled" && (
        <p role="note" className="warning">
          Le compte de {learner.firstName} est désactivé.
          {learner.scheduledDeletionAt !== null && (
            <>
              {" "}
              Ses données seront supprimées le{" "}
              {new Intl.DateTimeFormat("fr-FR", { timeZone: "Europe/Paris", dateStyle: "long" }).format(
                new Date(learner.scheduledDeletionAt),
              )}
              . Pour annuler, contactez le tuteur avant cette date.
            </>
          )}
        </p>
      )}
      <ErrorMessage error={progress.error ?? assignments.error} />
      <div className="stats">
        <Stat
          label="Dernière note"
          value={last === undefined ? "—" : `${numberFr(last.grade)} / 20`}
          detail={
            last === undefined ? "Aucune copie corrigée" : `${last.title} · ${longDate(last.publishedAt)}`
          }
        />
        <Stat
          label={main === undefined ? "Moyenne" : `Moyenne en ${main.name.toLowerCase()}`}
          value={main?.average === null || main?.average === undefined ? "—" : numberFr(main.average)}
          detail={main === undefined ? "Pas encore de note" : `sur ${plural(main.grades.length, "copie")}`}
        />
        <Stat
          label="À faire"
          value={plural(pending.length, "devoir")}
          detail={nextDue === undefined ? "Rien à rendre" : `avant ${weekdayHour(nextDue.dueAt)}`}
        />
        <Stat
          label="Prochaine séance"
          value={
            nextSession === undefined
              ? "—"
              : weekdayHour(nextSession.startsAt).replace(/^\w/, (c) => c.toUpperCase())
          }
          detail={nextSession === undefined ? "Aucune séance prévue" : nextSession.title}
        />
      </div>
      <div className="grid-main-side">
        <div className="stack">
          {data !== undefined && graded.length === 0 && (
            <Card>
              <h2>Notes</h2>
              <p>Aucune note publiée pour l'instant.</p>
            </Card>
          )}
          {graded.map((subject) => (
            <Card key={subject.subjectId} aria-labelledby={`notes-${subject.subjectId}`}>
              <h2 id={`notes-${subject.subjectId}`}>Évolution des notes en {subject.name.toLowerCase()}</h2>
              <GradeChart subject={subject} />
            </Card>
          ))}
          <Card aria-labelledby={`devoirs-${learner.id}`}>
            <h2 id={`devoirs-${learner.id}`}>Ses devoirs</h2>
            <ChildAssignments assignments={assignments.data?.assignments ?? []} now={now} />
          </Card>
          <Card aria-labelledby={`cours-${learner.id}`}>
            <h2 id={`cours-${learner.id}`}>Ses cours</h2>
            <ChildLessons learnerId={learner.id} />
          </Card>
          <Card aria-labelledby={`seances-${learner.id}`}>
            <h2 id={`seances-${learner.id}`}>Agenda des séances</h2>
            <p className="hint">Le lien de la visio n'est donné qu'à votre enfant, au moment de la séance.</p>
            <Agenda canJoin={false} nameOf={nameOf} />
          </Card>
        </div>
        <div className="stack">
          {data !== undefined && <SkillsSummary progress={data} subject={main?.name} />}
          {data !== undefined && (
            <Card aria-labelledby={`badges-${learner.id}`}>
              <h2 id={`badges-${learner.id}`}>Ses badges</h2>
              <p>
                Niveau {data.level} · {data.xp} points · série de {plural(data.streak.current, "semaine")}
                {data.streak.paused ? " (en pause)" : ""}
              </p>
              <Badges progress={data} />
            </Card>
          )}
          {learner.status === "active" && <ManageAccount learner={learner} />}
        </div>
      </div>
    </div>
  );
}

export function ChildAssignments({
  assignments,
  now,
}: {
  readonly assignments: readonly ChildAssignment[];
  readonly now: number;
}) {
  const pending = assignments.filter((assignment) =>
    ["upcoming", "open", "in_progress", "closed"].includes(assignment.state),
  );
  const late = pending.filter(
    (assignment) => Date.parse(assignment.dueAt) < now && assignment.state !== "upcoming",
  );
  const upcoming = pending.filter((assignment) => Date.parse(assignment.dueAt) >= now);
  if (late.length === 0 && upcoming.length === 0) return <p>Aucun devoir à venir ni en retard.</p>;
  return (
    <ul className="rows">
      {upcoming.map((assignment) => (
        <li key={assignment.assignmentId}>
          <div className="row-main">
            <p className="row-title">{assignment.title}</p>
            <p className="row-meta">
              {assignment.state === "upcoming"
                ? `S'ouvre le ${longDate(assignment.opensAt)} à ${hourFr(assignment.opensAt)}, `
                : ""}
              à rendre le {longDate(assignment.dueAt)} à {hourFr(assignment.dueAt)}
            </p>
          </div>
          {assignment.state === "upcoming" ? (
            <Pill tone="soon" icon={Calendar}>
              Bientôt
            </Pill>
          ) : (
            <Pill tone="todo" icon={Clock}>
              À rendre
            </Pill>
          )}
        </li>
      ))}
      {late.map((assignment) => (
        <li key={assignment.assignmentId}>
          <div className="row-main">
            <p className="row-title">{assignment.title}</p>
            <p className="row-meta">
              Attendu le {longDate(assignment.dueAt)} à {hourFr(assignment.dueAt)}
              {assignment.state === "closed"
                ? " · non rendu"
                : assignment.lateAllowed
                  ? " · encore possible"
                  : ""}
            </p>
          </div>
          {assignment.state === "closed" ? (
            <Pill tone="closed" icon={Lock}>
              Fermé
            </Pill>
          ) : (
            <Pill tone="todo" icon={Clock}>
              En retard
            </Pill>
          )}
        </li>
      ))}
    </ul>
  );
}

/** Ce que l'enfant a débloqué et terminé. */
function ChildLessons({ learnerId }: { readonly learnerId: string }) {
  const programme = useQuery({
    queryKey: ["learner-programme", learnerId],
    queryFn: () => fetchLearnerProgramme(learnerId),
  });
  if (programme.isPending) return <p role="status">Chargement…</p>;
  if (programme.isError) return <ErrorMessage error={programme.error} />;
  const lessons = programme.data.subjects.flatMap((subject) =>
    subject.modules.flatMap((module) =>
      module.lessons.map((lesson) => ({ ...lesson, module: module.title })),
    ),
  );
  if (lessons.length === 0) return <p>Aucun cours n'est encore ouvert pour cet enfant.</p>;
  return (
    <ul className="rows">
      {lessons.map((lesson) => (
        <li key={lesson.id}>
          <div className="row-main">
            <p className="row-title">{lesson.title}</p>
            <p className="row-meta">{lesson.module}</p>
          </div>
          {lesson.completedAt === null ? (
            <Pill tone="soon" icon={BookText}>
              Pas encore lu
            </Pill>
          ) : (
            <Pill tone="done" icon={Check}>
              Terminé le {longDate(lesson.completedAt)}
            </Pill>
          )}
        </li>
      ))}
    </ul>
  );
}

function SkillsSummary({
  progress,
  subject,
}: {
  readonly progress: LearnerProgress;
  readonly subject: string | undefined;
}) {
  const counts = competencyCounts(progress, subject);
  return (
    <Card aria-labelledby="competences">
      <h2 id="competences">Compétences{subject === undefined ? "" : ` en ${subject.toLowerCase()}`}</h2>
      <ul className="counts">
        <li>
          <span>Acquises</span> <strong>{counts.acquired}</strong>
        </li>
        <li>
          <span>En cours d'acquisition</span> <strong>{counts.inProgress}</strong>
        </li>
        <li>
          <span>Pas encore évaluées</span> <strong>{counts.notAssessed}</strong>
        </li>
      </ul>
      <details>
        <summary>Voir le détail</summary>
        <CompetencyList progress={progress} />
      </details>
    </Card>
  );
}

type Action = "password" | "invite" | "withdraw" | null;

/** Gestion du compte de l'enfant : mot de passe, autre parent, retrait de l'accord (confirmé). */
function ManageAccount({ learner }: { readonly learner: Learner }) {
  const me = useMe();
  const reauth = useReauth(me.data?.mfaEnrolled ?? false);
  const queryClient = useQueryClient();
  const [open, setOpen] = useState<Action>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const act = (work: () => Promise<void>, done: string) => {
    setError(null);
    setMessage(null);
    void (async () => {
      try {
        await work();
        setMessage(done);
        setOpen(null);
        setPassword("");
        setEmail("");
        await queryClient.invalidateQueries({ queryKey: LEARNERS_QUERY });
      } catch (caught) {
        setError(caught);
      }
    })();
  };
  const toggle = (action: Action) => {
    setOpen(open === action ? null : action);
    setMessage(null);
    setError(null);
  };

  return (
    <Card aria-labelledby={`gerer-${learner.id}`}>
      <h2 id={`gerer-${learner.id}`}>Gérer le compte de {learner.firstName}</h2>
      <p className="hint">
        Pseudo de connexion : <code>{learner.username}</code> · parents liés :{" "}
        {learner.guardians.map((guardian) => guardian.displayName).join(", ")}
      </p>
      <div className="stack-sm">
        <Button
          variant="secondary"
          aria-expanded={open === "password"}
          onClick={() => {
            toggle("password");
          }}
        >
          Nouveau mot de passe
        </Button>
        {open === "password" && (
          <form
            className="form-stack"
            onSubmit={(event) => {
              event.preventDefault();
              act(
                () => reauth.run(() => resetLearnerPassword(learner.id, password).then(() => undefined)),
                "Mot de passe changé.",
              );
            }}
          >
            <PasswordField
              label={`Nouveau mot de passe de ${learner.firstName}`}
              hint="8 caractères au moins."
              autoComplete="new-password"
              value={password}
              onChange={setPassword}
            />
            <Button type="submit">Changer le mot de passe</Button>
          </form>
        )}
        <Button
          variant="secondary"
          aria-expanded={open === "invite"}
          onClick={() => {
            toggle("invite");
          }}
        >
          Inviter l'autre parent
        </Button>
        {open === "invite" && (
          <form
            className="form-stack"
            onSubmit={(event) => {
              event.preventDefault();
              act(() => inviteCoGuardian(learner.id, email).then(() => undefined), "Invitation envoyée.");
            }}
          >
            <Field label="Son adresse e-mail">
              {(control) => (
                <input
                  {...control}
                  type="email"
                  autoComplete="off"
                  value={email}
                  onChange={(event) => {
                    setEmail(event.target.value);
                  }}
                  required
                />
              )}
            </Field>
            <Button type="submit">Envoyer l'invitation</Button>
          </form>
        )}
        {reauth.prompt}
        {open === "withdraw" ? (
          <div className="card dashed" role="group" aria-label="Confirmer le retrait de l'accord">
            <p>
              Le compte de {learner.firstName} sera désactivé tout de suite, et ses données supprimées sous 30
              jours.
            </p>
            <div className="actions">
              <Button
                variant="danger"
                onClick={() => {
                  act(
                    () => withdrawConsent(learner.id).then(() => undefined),
                    "Accord retiré : le compte est désactivé.",
                  );
                }}
              >
                Oui, retirer mon accord pour {learner.firstName}
              </Button>
              <Button
                variant="quiet"
                onClick={() => {
                  toggle(null);
                }}
              >
                Annuler
              </Button>
            </div>
          </div>
        ) : (
          <div>
            <Button
              variant="danger"
              className="btn-quiet"
              onClick={() => {
                toggle("withdraw");
              }}
            >
              Retirer mon accord et supprimer ses données
            </Button>
          </div>
        )}
      </div>
      {message !== null && (
        <p role="status" className="status-line">
          {message}
        </p>
      )}
      <ErrorMessage error={error} />
    </Card>
  );
}

function NewLearner({ open }: { readonly open: boolean }) {
  const queryClient = useQueryClient();
  const [firstName, setFirstName] = useState("");
  const [username, setUsername] = useState("");
  const [schoolLevel, setSchoolLevel] = useState<string>("6e");
  const [password, setPassword] = useState("");
  const create = useMutation({
    mutationFn: (consent: Parameters<typeof createLearner>[0]["consent"]) =>
      createLearner({ firstName, username, schoolLevel, password, consent }),
    onSuccess: async () => {
      setFirstName("");
      setUsername("");
      setPassword("");
      await queryClient.invalidateQueries({ queryKey: LEARNERS_QUERY });
    },
  });

  const form = (
    <ConsentForm
      pending={create.isPending}
      onSubmit={(consent) => {
        create.mutate(consent);
      }}
    >
      <fieldset className="form-stack">
        <legend>Votre enfant</legend>
        <div className="field-row">
          <Field label="Prénom">
            {(control) => (
              <input
                {...control}
                value={firstName}
                onChange={(event) => {
                  setFirstName(event.target.value);
                }}
                required
              />
            )}
          </Field>
          <Field label="Classe">
            {(control) => (
              <select
                {...control}
                value={schoolLevel}
                onChange={(event) => {
                  setSchoolLevel(event.target.value);
                }}
              >
                {LEVELS.map((level) => (
                  <option key={level} value={level}>
                    {level}
                  </option>
                ))}
              </select>
            )}
          </Field>
        </div>
        <Field
          label="Pseudo de connexion"
          hint="Par exemple « lina.ardoiz » : lettres sans accent, chiffres, point, tiret."
        >
          {(control) => (
            <input
              {...control}
              autoCapitalize="none"
              value={username}
              onChange={(event) => {
                setUsername(event.target.value);
              }}
              required
            />
          )}
        </Field>
        <PasswordField
          label="Son mot de passe"
          hint="8 caractères au moins."
          autoComplete="new-password"
          value={password}
          onChange={setPassword}
        />
        <ErrorMessage error={create.error} />
        {create.isSuccess && (
          <p role="status" className="status-line">
            Compte créé. Votre enfant peut se connecter avec son pseudo.
          </p>
        )}
      </fieldset>
    </ConsentForm>
  );

  return (
    <Card className="new-learner" aria-labelledby="nouvel-enfant">
      <h2 id="nouvel-enfant">Créer le compte d'un enfant</h2>
      <p className="hint">
        Seulement le prénom, un pseudo et la classe : Ardoiz ne demande ni nom de famille, ni date de
        naissance, ni photo.
      </p>
      {open ? (
        form
      ) : (
        <details>
          <summary>Ajouter un enfant</summary>
          {form}
        </details>
      )}
    </Card>
  );
}
