import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { fetchGroups } from "../api/curriculum";
import { fetchFamilies } from "../api/identity";
import {
  cancelOccurrence,
  changeSessionLink,
  fetchTutorSessions,
  moveOccurrence,
  planSession,
  type Occurrence,
} from "../api/scheduling";
import { ErrorMessage } from "../components/ErrorMessage";
import { Button, Card, Field, PageHeader, Pill } from "../ui";
import { localHourFr, plural } from "../ui/format";
import { ChevronLeft, ChevronRight, X } from "../ui/icons";
import { mondayOf, parisToday } from "./AgendaPages";

const SESSIONS = ["tutor-sessions"] as const;
const DURATIONS = [30, 45, 60, 75, 90, 120, 150, 180, 240] as const;

const addDays = (date: string, days: number) => {
  const [y = 0, m = 1, d = 1] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
};
const dayFormat = (date: string, options: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat("fr-FR", { timeZone: "UTC", ...options }).format(new Date(`${date}T00:00:00Z`));
const durationLabel = (minutes: number) =>
  minutes < 60
    ? `${String(minutes)} min`
    : `${String(Math.floor(minutes / 60))} h${minutes % 60 === 0 ? "" : ` ${String(minutes % 60)}`}`;

/** Nombre de séances d'une série hebdomadaire, du premier jour à la date de fin incluse. */
function weeklyCount(date: string, until: string): number {
  if (date === "" || until === "" || until < date) return 0;
  return Math.floor((Date.parse(until) - Date.parse(date)) / (7 * 86_400_000)) + 1;
}

/** Formulaire compact de planification (maquette Tuteur-Seances). */
function PlanForm() {
  const queryClient = useQueryClient();
  const families = useQuery({ queryKey: ["families"], queryFn: fetchFamilies });
  const groups = useQuery({ queryKey: ["groups"], queryFn: fetchGroups });
  const [title, setTitle] = useState("Séance de mathématiques");
  const [audience, setAudience] = useState("");
  const [kind, setKind] = useState<"once" | "weekly">("weekly");
  const [date, setDate] = useState(parisToday());
  const [time, setTime] = useState("14:00");
  const [duration, setDuration] = useState("60");
  const [until, setUntil] = useState("");
  const [link, setLink] = useState("");
  const [done, setDone] = useState(false);
  const plan = useMutation({
    mutationFn: () => {
      const [audienceKind, audienceId = ""] = audience.split(":");
      return planSession({
        title,
        audience: { kind: audienceKind === "group" ? "group" : "learner", id: audienceId },
        schedule: {
          kind,
          date,
          time,
          durationMinutes: Number(duration),
          ...(kind === "weekly" ? { until } : {}),
        },
        ...(link.trim() === "" ? {} : { link: link.trim() }),
      });
    },
    onSuccess: async () => {
      setDone(true);
      await queryClient.invalidateQueries({ queryKey: SESSIONS });
    },
  });
  const count = kind === "weekly" ? weeklyCount(date, until) : 1;
  return (
    <Card aria-labelledby="planifier">
      <h2 id="planifier">Planifier une séance</h2>
      <form
        className="form-stack"
        onSubmit={(event) => {
          event.preventDefault();
          setDone(false);
          plan.mutate();
        }}
      >
        <Field label="Titre">
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
        <fieldset>
          <legend>Fréquence</legend>
          <div className="choice-group square green">
            <label>
              <input
                type="radio"
                name="frequence"
                checked={kind === "once"}
                onChange={() => {
                  setKind("once");
                }}
              />
              Une fois
            </label>
            <label>
              <input
                type="radio"
                name="frequence"
                checked={kind === "weekly"}
                onChange={() => {
                  setKind("weekly");
                }}
              />
              Chaque semaine
            </label>
          </div>
        </fieldset>
        <div className="field-row two">
          <Field label={kind === "weekly" ? "Premier jour" : "Jour"}>
            {(control) => (
              <input
                {...control}
                type="date"
                required
                value={date}
                onChange={(event) => {
                  setDate(event.target.value);
                }}
              />
            )}
          </Field>
          <Field label="Heure">
            {(control) => (
              <input
                {...control}
                type="time"
                required
                value={time}
                onChange={(event) => {
                  setTime(event.target.value);
                }}
              />
            )}
          </Field>
          <Field label="Durée">
            {(control) => (
              <select
                {...control}
                value={duration}
                onChange={(event) => {
                  setDuration(event.target.value);
                }}
              >
                {DURATIONS.map((minutes) => (
                  <option key={minutes} value={String(minutes)}>
                    {durationLabel(minutes)}
                  </option>
                ))}
              </select>
            )}
          </Field>
          {kind === "weekly" && (
            <Field label="Jusqu'au">
              {(control) => (
                <input
                  {...control}
                  type="date"
                  required
                  min={date}
                  value={until}
                  onChange={(event) => {
                    setUntil(event.target.value);
                  }}
                />
              )}
            </Field>
          )}
        </div>
        <Field
          label="Lien de visio (facultatif)"
          hint="Laissez vide : Ardoiz crée une salle Jitsi au nom impossible à deviner. Avec Zoom ou Meet, activez la salle d'attente ; le lien n'est donné qu'aux élèves de la séance, 15 minutes avant."
        >
          {(control) => (
            <input
              {...control}
              type="url"
              maxLength={500}
              placeholder="https://meet.jit.si/…"
              value={link}
              onChange={(event) => {
                setLink(event.target.value);
              }}
            />
          )}
        </Field>
        <ErrorMessage error={plan.error} />
        {done && (
          <p role="status" className="status-line">
            Séance planifiée.
          </p>
        )}
        <Button type="submit" className="btn-wide" disabled={plan.isPending}>
          {kind === "weekly" && count > 1 ? `Planifier ${String(count)} séances` : "Planifier la séance"}
        </Button>
      </form>
    </Card>
  );
}

/** Une séance choisie dans la semaine : déplacer, annuler, annuler la suite (H8 : heures de Paris). */
function OccurrenceDetail({
  occurrence,
  names,
  onClose,
}: {
  readonly occurrence: Occurrence;
  readonly names: string;
  readonly onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [moving, setMoving] = useState(false);
  const [date, setDate] = useState(occurrence.local.date);
  const [time, setTime] = useState(occurrence.local.start);
  const minutes = Math.round((Date.parse(occurrence.endsAt) - Date.parse(occurrence.startsAt)) / 60_000);
  const refresh = () => queryClient.invalidateQueries({ queryKey: SESSIONS });
  const move = useMutation({
    mutationFn: () => moveOccurrence(occurrence.occurrenceId, { date, time, durationMinutes: minutes }),
    onSuccess: async () => {
      setMoving(false);
      await refresh();
    },
  });
  const cancel = useMutation({
    mutationFn: (wholeSeries: boolean) => cancelOccurrence(occurrence.occurrenceId, wholeSeries),
    onSuccess: refresh,
  });
  const day = dayFormat(occurrence.local.date, { weekday: "long", day: "numeric", month: "long" });
  return (
    <Card aria-labelledby="seance-choisie" className="highlight">
      <div className="card-head">
        <h2 id="seance-choisie">
          {occurrence.title} · {day}, {localHourFr(occurrence.local.start)} –{" "}
          {localHourFr(occurrence.local.end)}
        </h2>
        <Button variant="quiet" icon={X} onClick={onClose}>
          Fermer
        </Button>
      </div>
      <p>Avec {names}</p>
      {occurrence.status === "cancelled" ? (
        <Pill tone="closed">Annulée</Pill>
      ) : (
        <div className="actions">
          {occurrence.moved && <Pill tone="soon">Déplacée</Pill>}
          <Button
            variant="secondary"
            aria-expanded={moving}
            onClick={() => {
              setMoving(!moving);
            }}
          >
            Déplacer
          </Button>
          <Button
            variant="danger"
            onClick={() => {
              if (window.confirm("Annuler cette séance ?")) cancel.mutate(false);
            }}
          >
            Annuler
          </Button>
          <Button
            variant="danger"
            onClick={() => {
              if (window.confirm("Annuler cette séance et toutes les suivantes de la série ?"))
                cancel.mutate(true);
            }}
          >
            Annuler la suite
          </Button>
        </div>
      )}
      {moving && (
        <form
          className="inline section-gap"
          onSubmit={(event) => {
            event.preventDefault();
            move.mutate();
          }}
        >
          <Field label="Nouvelle date">
            {(control) => (
              <input
                {...control}
                type="date"
                value={date}
                onChange={(event) => {
                  setDate(event.target.value);
                }}
              />
            )}
          </Field>
          <Field label="Heure">
            {(control) => (
              <input
                {...control}
                type="time"
                value={time}
                onChange={(event) => {
                  setTime(event.target.value);
                }}
              />
            )}
          </Field>
          <Button type="submit" disabled={move.isPending}>
            Enregistrer
          </Button>
        </form>
      )}
      <ErrorMessage error={move.error ?? cancel.error} />
    </Card>
  );
}

/** Séances du tuteur (L5, maquette Tuteur-Seances) : la semaine, le formulaire compact, les liens (R9, M10, H8). */
export function TutorSessionsPage() {
  const queryClient = useQueryClient();
  const sessions = useQuery({ queryKey: SESSIONS, queryFn: fetchTutorSessions });
  const families = useQuery({ queryKey: ["families"], queryFn: fetchFamilies });
  const [week, setWeek] = useState(0);
  const [selected, setSelected] = useState<string | null>(null);
  const relink = useMutation({
    mutationFn: (sessionId: string) => changeSessionLink(sessionId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: SESSIONS }),
  });
  const nameOf = (learnerId: string) =>
    families.data?.learners.find((learner) => learner.id === learnerId)?.firstName ?? "Élève";
  const today = parisToday();
  const monday = mondayOf(today, week);
  const days = Array.from({ length: 7 }, (_, index) => addDays(monday, index));
  const occurrences = (sessions.data?.sessions ?? []).flatMap((session) => session.occurrences);
  const chosen = occurrences.find((occurrence) => occurrence.occurrenceId === selected);
  const range = `${dayFormat(days[0] ?? monday, { day: "numeric" })} – ${dayFormat(days[6] ?? monday, { day: "numeric", month: "long" })}`;

  return (
    <div className="page">
      <PageHeader
        title="Séances"
        actions={
          <div className="week-nav" role="group" aria-label="Semaine affichée">
            <Button
              variant="secondary"
              className="btn-icon"
              icon={ChevronLeft}
              aria-label="Semaine précédente"
              onClick={() => {
                setWeek(week - 1);
              }}
            />
            <span className="label" aria-live="polite">
              {range}
            </span>
            <Button
              variant="secondary"
              className="btn-icon"
              icon={ChevronRight}
              aria-label="Semaine suivante"
              onClick={() => {
                setWeek(week + 1);
              }}
            />
          </div>
        }
      />
      <div className="grid-main-side">
        <div className="stack">
          {sessions.isPending && <p role="status">Chargement…</p>}
          <ErrorMessage error={sessions.error ?? relink.error} />
          <ol className="week" aria-label={`Semaine du ${range}`}>
            {days.map((day) => {
              const items = occurrences
                .filter((occurrence) => occurrence.local.date === day)
                .sort((a, b) => a.local.start.localeCompare(b.local.start));
              const weekday = new Date(`${day}T00:00:00Z`).getUTCDay();
              return (
                <li key={day} data-today={day === today} data-weekend={weekday === 0 || weekday === 6}>
                  <h3>
                    {dayFormat(day, { weekday: "short", day: "numeric" }).replace(/^\w/, (c) =>
                      c.toUpperCase(),
                    )}
                  </h3>
                  {items.map((occurrence) => (
                    <button
                      key={occurrence.occurrenceId}
                      type="button"
                      className="slot"
                      aria-pressed={selected === occurrence.occurrenceId}
                      data-cancelled={occurrence.status === "cancelled"}
                      onClick={() => {
                        setSelected(selected === occurrence.occurrenceId ? null : occurrence.occurrenceId);
                      }}
                    >
                      <strong>{localHourFr(occurrence.local.start)}</strong>
                      <span>
                        {occurrence.title}
                        {occurrence.status === "cancelled" ? " (annulée)" : ""}
                      </span>
                      <span>{occurrence.participantIds.map(nameOf).join(", ")}</span>
                    </button>
                  ))}
                </li>
              );
            })}
          </ol>
          <p className="hint">
            Heures de Paris. Le lien de visio n'apparaît chez l'élève que 15 minutes avant la séance.
          </p>
          {chosen !== undefined && (
            <OccurrenceDetail
              key={chosen.occurrenceId}
              occurrence={chosen}
              names={chosen.participantIds.map(nameOf).join(", ")}
              onClose={() => {
                setSelected(null);
              }}
            />
          )}
          <Card aria-labelledby="series">
            <h2 id="series">Séries et liens de visio</h2>
            {sessions.data?.sessions.length === 0 && <p>Aucune séance planifiée.</p>}
            <ul className="rows">
              {sessions.data?.sessions.map((session) => (
                <li key={session.id}>
                  <div className="row-main">
                    <h3>{session.title}</h3>
                    <p className="row-meta">
                      Avec {session.learnerIds.map(nameOf).join(", ")} ·{" "}
                      {session.kind === "weekly" ? "chaque semaine" : "une fois"} ·{" "}
                      {plural(
                        session.occurrences.filter((occurrence) => occurrence.status === "scheduled").length,
                        "séance à venir",
                        "séances à venir",
                      )}
                    </p>
                    <p className="row-meta">
                      Lien : <code>{session.meetingLink}</code>
                    </p>
                    {session.linkToReplace && (
                      <p role="status">
                        <Pill tone="todo">Lien à remplacer : il n'est plus donné aux élèves</Pill>
                      </p>
                    )}
                  </div>
                  <Button
                    variant="secondary"
                    aria-label={`Nouveau lien pour ${session.title}`}
                    onClick={() => {
                      if (
                        window.confirm(
                          "Créer une nouvelle salle Jitsi ? L'ancien lien ne sera plus donné à personne.",
                        )
                      ) {
                        relink.mutate(session.id);
                      }
                    }}
                  >
                    Nouveau lien
                  </Button>
                </li>
              ))}
            </ul>
          </Card>
        </div>
        <PlanForm />
      </div>
    </div>
  );
}
