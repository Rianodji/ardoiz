import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link, useSearchParams } from "react-router";
import { fetchAssessments, fetchAssignments, fetchGradingQueue } from "../api/assessment";
import { createGroup, fetchGroups, setGroupMembers } from "../api/curriculum";
import {
  fetchAudit,
  fetchFamilies,
  inviteGuardian,
  resetLearnerPassword,
  revokeGuardianship,
} from "../api/identity";
import { fetchSuggestions } from "../api/progress";
import { fetchTutorSessions } from "../api/scheduling";
import { useMe } from "../auth/session";
import { ErrorMessage } from "../components/ErrorMessage";
import { useReauth } from "../components/useReauth";
import {
  Button,
  ButtonLink,
  Card,
  Field,
  Icon,
  Notice,
  PageHeader,
  Pill,
  Stat,
  TableBox,
  Tabs,
  type PillTone,
} from "../ui";
import { hourFr, plural, shortDate, shortDateTime, todayTitle, weekdayHour } from "../ui/format";
import { Users, Video } from "../ui/icons";
import { mondayOf, parisToday, useNow } from "./AgendaPages";
import { PasswordField } from "./LoginPage";
import { AUDIT_REASON_LABELS, auditActionLabel, auditActorLabel } from "./auditLabels";

const FAMILIES_QUERY = ["families"] as const;

/**
 * « Aujourd'hui » (maquette Tuteur-Accueil) : les files de travail du jour. Copies à corriger, séance
 * du jour, échéances de la semaine, suggestions non lues. Rien n'y est calculé côté serveur de neuf :
 * l'écran assemble les réponses existantes (contrats d'API inchangés).
 */
export function TutorTodayPage() {
  const now = useNow();
  const queue = useQuery({ queryKey: ["grading-queue"], queryFn: fetchGradingQueue });
  const sessions = useQuery({ queryKey: ["tutor-sessions"], queryFn: fetchTutorSessions });
  const suggestions = useQuery({ queryKey: ["suggestions"], queryFn: fetchSuggestions });
  const assignments = useQuery({ queryKey: ["assignments"], queryFn: fetchAssignments });
  const assessments = useQuery({ queryKey: ["assessments"], queryFn: fetchAssessments });
  const families = useQuery({ queryKey: FAMILIES_QUERY, queryFn: fetchFamilies });
  const groups = useQuery({ queryKey: ["groups"], queryFn: fetchGroups });

  const nameOf = (id: string) =>
    families.data?.learners.find((learner) => learner.id === id)?.firstName ?? "Élève";
  const titleOf = (assessmentId: string) =>
    assessments.data?.assessments.find((assessment) => assessment.id === assessmentId)?.title ?? "Épreuve";
  const audienceOf = (learnerIds: readonly string[]) => {
    const group = groups.data?.groups.find(
      (candidate) =>
        candidate.learnerIds.length === learnerIds.length &&
        candidate.learnerIds.every((id) => learnerIds.includes(id)),
    );
    return group === undefined ? learnerIds.map(nameOf).join(", ") : `groupe ${group.name}`;
  };

  const toGrade = (queue.data?.attempts ?? [])
    .filter((attempt) => attempt.status === "submitted")
    .sort((a, b) => Date.parse(a.submittedAt ?? "") - Date.parse(b.submittedAt ?? ""));
  const toPublish = (queue.data?.attempts ?? []).filter((attempt) => attempt.status === "graded");
  const today = parisToday();
  const todays = (sessions.data?.sessions ?? [])
    .flatMap((session) =>
      session.occurrences
        .filter((occurrence) => occurrence.local.date === today && occurrence.status === "scheduled")
        .map((occurrence) => ({ session, occurrence })),
    )
    .sort((a, b) => Date.parse(a.occurrence.startsAt) - Date.parse(b.occurrence.startsAt));
  const nextToday = todays.find((entry) => Date.parse(entry.occurrence.endsAt) > now) ?? todays.at(-1);
  const unread = (suggestions.data?.suggestions ?? []).filter((entry) => entry.status === "new").length;
  // Semaine du lundi au dimanche, en dates de Paris (H8) : aucun calcul d'heure à la main.
  const monday = mondayOf(today);
  const nextMonday = mondayOf(today, 1);
  const inWeek = (iso: string) => {
    const day = parisToday(new Date(iso));
    return day >= monday && day < nextMonday;
  };
  const thisWeek = (assignments.data?.assignments ?? [])
    .filter(
      (assignment) =>
        (inWeek(assignment.dueAt) && Date.parse(assignment.dueAt) >= now) ||
        (inWeek(assignment.opensAt) && Date.parse(assignment.opensAt) > now),
    )
    .sort((a, b) => Date.parse(a.dueAt) - Date.parse(b.dueAt));

  return (
    <div className="page">
      <PageHeader
        eyebrow={todayTitle(now)}
        title="Aujourd'hui"
        actions={
          <>
            <ButtonLink to="/tuteur/seances" variant="secondary">
              Planifier une séance
            </ButtonLink>
            <ButtonLink to="/tuteur/epreuves">Créer une épreuve</ButtonLink>
          </>
        }
      />
      <ErrorMessage error={queue.error ?? sessions.error ?? suggestions.error ?? assignments.error} />
      <div className="stats">
        <Stat
          label="À corriger"
          value={plural(toGrade.length, "copie")}
          {...(toPublish.length > 0 ? { detail: `${plural(toPublish.length, "note")} à publier` } : {})}
        />
        <Stat label="Séances aujourd'hui" value={todays.length} />
        <Stat label="Suggestions non lues" value={unread} />
        <Stat label="Échéances cette semaine" value={thisWeek.length} />
      </div>
      <div className="grid-main-side">
        <Card aria-labelledby="copies">
          <div className="card-head">
            <h2 id="copies">Copies à corriger</h2>
            <Link to="/tuteur/corrections">Toute la file</Link>
          </div>
          {queue.data !== undefined && toGrade.length === 0 && <p>Aucune copie en attente. </p>}
          <ul className="rows">
            {toGrade.slice(0, 5).map((attempt) => (
              <li key={attempt.attemptId}>
                <div className="row-main">
                  <p>
                    <strong>{nameOf(attempt.learnerId)}</strong> · {attempt.title}
                  </p>
                  <p className="row-meta">
                    {attempt.submittedAt === null ? "" : `Rendue le ${shortDateTime(attempt.submittedAt)}`}
                    {attempt.late ? " · en retard autorisé" : ""}
                  </p>
                </div>
                <ButtonLink
                  to={`/tuteur/corrections/${attempt.attemptId}`}
                  aria-label={`Corriger la copie de ${nameOf(attempt.learnerId)} : ${attempt.title}`}
                >
                  Corriger
                </ButtonLink>
              </li>
            ))}
          </ul>
        </Card>
        <Card aria-labelledby="seance-du-jour">
          <h2 id="seance-du-jour">Séance du jour</h2>
          {nextToday === undefined ? (
            <p>Pas de séance aujourd'hui.</p>
          ) : (
            <div className="stack-sm">
              <p className="stat-value">
                {hourFr(nextToday.occurrence.startsAt)} – {hourFr(nextToday.occurrence.endsAt)}
              </p>
              <p>
                {nextToday.session.title} · {nextToday.session.learnerIds.map(nameOf).join(", ")}
              </p>
              <a
                className="btn btn-primary"
                href={nextToday.session.meetingLink}
                target="_blank"
                rel="noopener noreferrer"
              >
                <Icon icon={Video} />
                Ouvrir la visio
              </a>
              <p className="hint">Pensez à activer la salle d'attente au début de la séance.</p>
            </div>
          )}
        </Card>
      </div>
      <Card aria-labelledby="echeances" className="section-gap">
        <h2 id="echeances">Échéances de la semaine</h2>
        {assignments.data !== undefined && thisWeek.length === 0 && <p>Aucune échéance cette semaine.</p>}
        <ul className="rows">
          {thisWeek.map((assignment) => {
            const upcoming = Date.parse(assignment.opensAt) > now;
            return (
              <li key={assignment.id}>
                <div className="row-main">
                  <p>
                    {upcoming ? (
                      <Pill tone="soon">S'ouvre {weekdayHour(assignment.opensAt)}</Pill>
                    ) : (
                      <Pill tone="todo">{weekdayHour(assignment.dueAt)}</Pill>
                    )}{" "}
                    {titleOf(assignment.assessmentId)} · {audienceOf(assignment.learnerIds)}
                  </p>
                </div>
                <span className="row-meta">
                  {upcoming ? "pas encore ouverte" : `à rendre le ${shortDate(assignment.dueAt)}`}
                </span>
              </li>
            );
          })}
        </ul>
      </Card>
    </div>
  );
}

type FamilyTab = "eleves" | "groupes" | "parents";

/**
 * Élèves et familles (maquette Tuteur-Eleves) : élèves, groupes et parents ; inviter un parent ;
 * révoquer un lien (H1) ; l'adresse e-mail d'un parent n'est affichée qu'à la demande (minimisation).
 */
export function TutorFamiliesPage() {
  const queryClient = useQueryClient();
  const [params, setParams] = useSearchParams();
  const tab: FamilyTab =
    params.get("onglet") === "groupes"
      ? "groupes"
      : params.get("onglet") === "parents"
        ? "parents"
        : "eleves";
  const families = useQuery({ queryKey: FAMILIES_QUERY, queryFn: fetchFamilies });
  const groups = useQuery({ queryKey: ["groups"], queryFn: fetchGroups });
  const [email, setEmail] = useState("");
  const invite = useMutation({
    mutationFn: () => inviteGuardian(email),
    onSuccess: async () => {
      setEmail("");
      await queryClient.invalidateQueries({ queryKey: FAMILIES_QUERY });
    },
  });
  const learners = families.data?.learners ?? [];
  const guardians = families.data?.guardians ?? [];

  return (
    <div className="page">
      <PageHeader
        title="Élèves et familles"
        actions={
          <form
            className="inline invite-form"
            onSubmit={(event) => {
              event.preventDefault();
              invite.mutate();
            }}
          >
            <Field label="Inviter un parent">
              {(control) => (
                <input
                  {...control}
                  type="email"
                  placeholder="adresse e-mail du parent"
                  autoComplete="off"
                  value={email}
                  onChange={(event) => {
                    setEmail(event.target.value);
                  }}
                  required
                />
              )}
            </Field>
            <Button type="submit" disabled={invite.isPending}>
              Envoyer l'invitation
            </Button>
          </form>
        }
      />
      <ErrorMessage error={invite.error ?? families.error} />
      {invite.isSuccess && (
        <p role="status" className="status-line">
          Invitation envoyée (valable 72 heures).
        </p>
      )}
      <Tabs
        label="Élèves et familles"
        tabs={[
          { key: "eleves", label: `Élèves (${String(learners.length)})` },
          { key: "groupes", label: `Groupes (${String(groups.data?.groups.length ?? 0)})` },
          { key: "parents", label: `Parents (${String(guardians.length)})` },
        ]}
        selected={tab}
        onSelect={(key) => {
          setParams(key === "eleves" ? {} : { onglet: key }, { replace: true });
        }}
      >
        {tab === "eleves" && <LearnersTab />}
        {tab === "groupes" && <GroupsTab />}
        {tab === "parents" && (
          <Card>
            {guardians.length === 0 ? (
              <p>Aucun parent inscrit.</p>
            ) : (
              <ul className="rows">
                {guardians.map((guardian) => (
                  <li key={guardian.id}>
                    <div className="row-main">
                      <p className="row-title">{guardian.displayName}</p>
                      <p className="row-meta">
                        Parent de{" "}
                        {learners
                          .filter((learner) =>
                            learner.guardians.some((link) => link.guardianId === guardian.id),
                          )
                          .map((learner) => learner.firstName)
                          .join(", ") || "aucun élève pour l'instant"}
                      </p>
                    </div>
                    <RevealEmail email={guardian.email} name={guardian.displayName} />
                  </li>
                ))}
              </ul>
            )}
          </Card>
        )}
      </Tabs>
    </div>
  );
}

/** Adresse e-mail d'un parent, montrée seulement sur demande (L8 : écran « Élèves et familles »). */
function RevealEmail({ email, name }: { readonly email: string; readonly name: string }) {
  const [shown, setShown] = useState(false);
  return shown ? (
    <span>
      <span className="visually-hidden">Adresse de {name} : </span>
      {email}
    </span>
  ) : (
    <button
      type="button"
      className="link-button"
      aria-label={`Afficher l'adresse e-mail de ${name}`}
      onClick={() => {
        setShown(true);
      }}
    >
      afficher l'adresse e-mail
    </button>
  );
}

function LearnersTab() {
  const queryClient = useQueryClient();
  const families = useQuery({ queryKey: FAMILIES_QUERY, queryFn: fetchFamilies });
  const groups = useQuery({ queryKey: ["groups"], queryFn: fetchGroups });
  const reauth = useReauth(true);
  const [selected, setSelected] = useState<string | null>(null);
  const [resetting, setResetting] = useState<string | null>(null);
  const [revoking, setRevoking] = useState<string | null>(null);
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const act = (work: () => Promise<void>, done: string) => {
    setError(null);
    setMessage(null);
    void (async () => {
      try {
        await reauth.run(work);
        setMessage(done);
        setResetting(null);
        setRevoking(null);
        setPassword("");
        await queryClient.invalidateQueries({ queryKey: FAMILIES_QUERY });
      } catch (caught) {
        setError(caught);
      }
    })();
  };
  const learners = families.data?.learners ?? [];
  const guardians = families.data?.guardians ?? [];
  const current = learners.find((learner) => learner.id === selected);
  const groupsOf = (id: string) =>
    (groups.data?.groups ?? []).filter((group) => group.learnerIds.includes(id)).map((group) => group.name);

  return (
    <div className="stack">
      {families.isPending && <p role="status">Chargement…</p>}
      {reauth.prompt}
      {message !== null && (
        <p role="status" className="status-line">
          {message}
        </p>
      )}
      <ErrorMessage error={error} />
      <Card>
        {learners.length === 0 && families.data !== undefined ? (
          <p>Aucun élève pour l'instant : invitez un parent, il créera le compte de son enfant.</p>
        ) : (
          <TableBox label="Élèves">
            <thead>
              <tr>
                <th scope="col">Élève</th>
                <th scope="col">Pseudo</th>
                <th scope="col">Classe</th>
                <th scope="col">Groupe</th>
                <th scope="col">Parents liés</th>
                <th scope="col">Actions</th>
              </tr>
            </thead>
            <tbody>
              {learners.map((learner) => (
                <tr key={learner.id}>
                  <th scope="row">
                    {learner.firstName}
                    {learner.status === "disabled" && (
                      <>
                        {" "}
                        <Pill tone="closed">désactivé</Pill>
                      </>
                    )}
                  </th>
                  <td>
                    <code>{learner.username}</code>
                  </td>
                  <td>{learner.schoolLevel}</td>
                  <td>
                    {groupsOf(learner.id).length === 0
                      ? "aucun"
                      : groupsOf(learner.id).map((name) => (
                          <Pill key={name} tone="done">
                            {name}
                          </Pill>
                        ))}
                  </td>
                  <td>{learner.guardians.map((guardian) => guardian.displayName).join(", ")}</td>
                  <td>
                    <div className="actions">
                      <Button
                        variant="secondary"
                        aria-label={`Fiche de ${learner.firstName}`}
                        aria-expanded={selected === learner.id}
                        onClick={() => {
                          setSelected(selected === learner.id ? null : learner.id);
                          setResetting(null);
                        }}
                      >
                        Fiche
                      </Button>
                      <Button
                        variant="secondary"
                        aria-label={`Nouveau mot de passe pour ${learner.firstName}`}
                        onClick={() => {
                          setSelected(learner.id);
                          setResetting(learner.id);
                        }}
                      >
                        Nouveau mot de passe
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </TableBox>
        )}
      </Card>
      {current !== undefined && (
        <Card aria-labelledby="fiche">
          <h2 id="fiche">Fiche de {current.firstName}</h2>
          <div className="grid-two">
            <div className="stack-sm">
              <p>
                Pseudo <code>{current.username}</code> · classe {current.schoolLevel}
                {current.status === "disabled" ? " · compte désactivé" : ""}
              </p>
              {current.guardians.map((link) => {
                const guardian = guardians.find((entry) => entry.id === link.guardianId);
                return (
                  <p key={link.guardianshipId}>
                    <strong>Parent :</strong> {link.displayName}
                    {guardian !== undefined && (
                      <>
                        {" · "}
                        <RevealEmail email={guardian.email} name={link.displayName} />
                      </>
                    )}
                  </p>
                );
              })}
            </div>
            <div className="stack-sm">
              <ButtonLink to={`/tuteur/progression?eleve=${current.id}`} variant="secondary">
                Voir sa progression
              </ButtonLink>
              {current.guardians.map((link) =>
                revoking === link.guardianshipId ? (
                  <div
                    key={link.guardianshipId}
                    className="card dashed"
                    role="group"
                    aria-label="Confirmer la révocation"
                  >
                    <p>
                      {link.displayName} ne verra plus rien de {current.firstName}. Confirmer ?
                    </p>
                    <div className="actions">
                      <Button
                        variant="danger"
                        onClick={() => {
                          act(
                            () => revokeGuardianship(link.guardianshipId).then(() => undefined),
                            `Lien de ${link.displayName} avec ${current.firstName} révoqué.`,
                          );
                        }}
                      >
                        Oui, révoquer le lien
                      </Button>
                      <Button
                        variant="quiet"
                        onClick={() => {
                          setRevoking(null);
                        }}
                      >
                        Annuler
                      </Button>
                    </div>
                  </div>
                ) : (
                  <Button
                    key={link.guardianshipId}
                    variant="danger"
                    className="btn-quiet"
                    onClick={() => {
                      setRevoking(link.guardianshipId);
                    }}
                  >
                    Révoquer le lien avec {link.displayName}
                  </Button>
                ),
              )}
            </div>
          </div>
          {resetting === current.id && (
            <form
              className="form-stack section-gap"
              onSubmit={(event) => {
                event.preventDefault();
                act(
                  () => resetLearnerPassword(current.id, password).then(() => undefined),
                  `Mot de passe de ${current.firstName} changé.`,
                );
              }}
            >
              <PasswordField
                label={`Mot de passe de ${current.firstName}`}
                hint="8 caractères au moins."
                autoComplete="new-password"
                value={password}
                onChange={setPassword}
              />
              <div className="actions">
                <Button type="submit">Enregistrer</Button>
                <Button
                  variant="quiet"
                  onClick={() => {
                    setResetting(null);
                  }}
                >
                  Annuler
                </Button>
              </div>
            </form>
          )}
        </Card>
      )}
    </div>
  );
}

/** Groupes d'élèves (« 6e ») : leurs membres reçoivent les déverrouillages du groupe. */
function GroupsTab() {
  const queryClient = useQueryClient();
  const groups = useQuery({ queryKey: ["groups"], queryFn: fetchGroups });
  const families = useQuery({ queryKey: FAMILIES_QUERY, queryFn: fetchFamilies });
  const [name, setName] = useState("");
  const create = useMutation({
    mutationFn: () => createGroup(name),
    onSuccess: async () => {
      setName("");
      await queryClient.invalidateQueries({ queryKey: ["groups"] });
    },
  });
  const members = useMutation({
    mutationFn: ({ id, learnerIds }: { id: string; learnerIds: string[] }) => setGroupMembers(id, learnerIds),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["groups"] }),
  });
  return (
    <div className="stack">
      <ErrorMessage error={groups.error ?? members.error} />
      {groups.data?.groups.length === 0 && <Notice icon={Users}>Aucun groupe pour l'instant.</Notice>}
      <div className="cards-row">
        {groups.data?.groups.map((group) => (
          <Card key={group.id}>
            <fieldset>
              <legend>
                Groupe {group.name} · {plural(group.learnerIds.length, "élève")}
              </legend>
              {families.data?.learners.map((learner) => {
                const checked = group.learnerIds.includes(learner.id);
                return (
                  <label key={learner.id} className="check-line">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => {
                        members.mutate({
                          id: group.id,
                          learnerIds: checked
                            ? group.learnerIds.filter((id) => id !== learner.id)
                            : [...group.learnerIds, learner.id],
                        });
                      }}
                    />
                    {learner.firstName}
                  </label>
                );
              })}
            </fieldset>
          </Card>
        ))}
      </div>
      <Card className="dashed">
        <form
          className="inline"
          onSubmit={(event) => {
            event.preventDefault();
            create.mutate();
          }}
        >
          <Field label="Nouveau groupe" className="grow">
            {(control) => (
              <input
                {...control}
                placeholder="Par exemple : 6e"
                value={name}
                onChange={(event) => {
                  setName(event.target.value);
                }}
                required
              />
            )}
          </Field>
          <Button type="submit" disabled={create.isPending}>
            Créer le groupe
          </Button>
        </form>
        <ErrorMessage error={create.error} />
      </Card>
    </div>
  );
}

const PERIODS = { "7": "7 derniers jours", "30": "30 derniers jours", tout: "Tout" } as const;
const TYPES = {
  tout: { label: "Tout", modules: null },
  comptes: { label: "Comptes et accords", modules: ["identity", "privacy"] },
  notes: { label: "Épreuves et notes", modules: ["assessment"] },
  cours: { label: "Programme et cours", modules: ["curriculum"] },
  seances: { label: "Séances", modules: ["scheduling"] },
  suivi: { label: "Progression et suggestions", modules: ["progress", "feedback"] },
} as const;
const RESULTS = { tous: "Tous", success: "Réussis", denied: "Refusés", failed: "Échoués" } as const;

const OUTCOMES: Readonly<Record<string, { label: string; tone: PillTone }>> = {
  success: { label: "Réussie", tone: "done" },
  denied: { label: "Refusé", tone: "alert" },
  failed: { label: "Échoué", tone: "todo" },
};

/** Journal d'audit (R12, maquette Tuteur-Journal) : des phrases en français, des filtres, jamais les codes. */
export function AuditPage() {
  const me = useMe();
  const now = useNow();
  const audit = useQuery({ queryKey: ["audit"], queryFn: fetchAudit });
  const families = useQuery({ queryKey: FAMILIES_QUERY, queryFn: fetchFamilies });
  const [period, setPeriod] = useState<keyof typeof PERIODS>("7");
  const [type, setType] = useState<keyof typeof TYPES>("tout");
  const [result, setResult] = useState<keyof typeof RESULTS>("tous");

  const actorOf = (kind: string, id: string | null) => {
    if (kind === "tutor" && id === me.data?.id) return "Vous";
    const name =
      kind === "guardian"
        ? families.data?.guardians.find((guardian) => guardian.id === id)?.displayName
        : kind === "learner"
          ? families.data?.learners.find((learner) => learner.id === id)?.firstName
          : undefined;
    return name === undefined ? auditActorLabel(kind) : `${auditActorLabel(kind)} · ${name}`;
  };
  const since = period === "tout" ? 0 : now - Number(period) * 86_400_000;
  const modules = TYPES[type].modules;
  const entries = (audit.data?.entries ?? []).filter(
    (entry) =>
      Date.parse(entry.occurredAt) >= since &&
      (modules === null || (modules as readonly string[]).includes(entry.action.split(".")[0] ?? "")) &&
      (result === "tous" || entry.outcome === result),
  );

  return (
    <div className="page">
      <PageHeader
        title="Journal d'audit"
        lead="Tout ce qui touche aux comptes, aux accords des parents, aux notes et aux accès refusés. Conservé 6 mois, impossible à modifier."
      />
      <div className="filters compact">
        <Field label="Période">
          {(control) => (
            <select
              {...control}
              value={period}
              onChange={(event) => {
                setPeriod(event.target.value as keyof typeof PERIODS);
              }}
            >
              {Object.entries(PERIODS).map(([key, label]) => (
                <option key={key} value={key}>
                  {label}
                </option>
              ))}
            </select>
          )}
        </Field>
        <Field label="Type">
          {(control) => (
            <select
              {...control}
              value={type}
              onChange={(event) => {
                setType(event.target.value as keyof typeof TYPES);
              }}
            >
              {Object.entries(TYPES).map(([key, entry]) => (
                <option key={key} value={key}>
                  {entry.label}
                </option>
              ))}
            </select>
          )}
        </Field>
        <Field label="Résultat">
          {(control) => (
            <select
              {...control}
              value={result}
              onChange={(event) => {
                setResult(event.target.value as keyof typeof RESULTS);
              }}
            >
              {Object.entries(RESULTS).map(([key, label]) => (
                <option key={key} value={key}>
                  {label}
                </option>
              ))}
            </select>
          )}
        </Field>
      </div>
      {audit.isPending && <p role="status">Chargement…</p>}
      <ErrorMessage error={audit.error} />
      <Card>
        <p className="hint" aria-live="polite">
          {plural(entries.length, "entrée")}
        </p>
        <TableBox label="Entrées du journal d'audit">
          <thead>
            <tr>
              <th scope="col">Quand (heure de Paris)</th>
              <th scope="col">Événement</th>
              <th scope="col">Par</th>
              <th scope="col">Résultat</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((entry, index) => {
              const outcome = OUTCOMES[entry.outcome] ?? { label: "Inconnu", tone: "neutral" as const };
              const late = entry.reasonCode === "late";
              const reason =
                entry.reasonCode === null || late ? undefined : AUDIT_REASON_LABELS[entry.reasonCode];
              return (
                <tr key={`${entry.occurredAt}-${String(index)}`}>
                  <td className="num">{shortDateTime(entry.occurredAt)}</td>
                  <td>
                    {auditActionLabel(entry.action)}
                    {reason !== undefined && <span className="hint"> ({reason})</span>}
                  </td>
                  <td>{actorOf(entry.actorKind, entry.actorId)}</td>
                  <td>
                    {late && entry.outcome === "success" ? (
                      <Pill tone="todo">En retard</Pill>
                    ) : (
                      <Pill tone={outcome.tone}>{outcome.label}</Pill>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </TableBox>
      </Card>
    </div>
  );
}
