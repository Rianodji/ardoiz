import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useId, useState } from "react";
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
import { parisToday } from "./AgendaPages";

const SESSIONS = ["tutor-sessions"] as const;

function PlanForm() {
  const queryClient = useQueryClient();
  const families = useQuery({ queryKey: ["families"], queryFn: fetchFamilies });
  const groups = useQuery({ queryKey: ["groups"], queryFn: fetchGroups });
  const id = useId();
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
  return (
    <form
      className="stack"
      onSubmit={(event) => {
        event.preventDefault();
        setDone(false);
        plan.mutate();
      }}
    >
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
      <label htmlFor={`${id}-kind`}>Fréquence</label>
      <select
        id={`${id}-kind`}
        value={kind}
        onChange={(event) => {
          setKind(event.target.value === "once" ? "once" : "weekly");
        }}
      >
        <option value="weekly">chaque semaine, jusqu'à une date</option>
        <option value="once">une seule fois</option>
      </select>
      <label htmlFor={`${id}-date`}>{kind === "weekly" ? "Première séance" : "Date"} (heure de Paris)</label>
      <input
        id={`${id}-date`}
        type="date"
        required
        value={date}
        onChange={(event) => {
          setDate(event.target.value);
        }}
      />
      <label htmlFor={`${id}-time`}>Heure</label>
      <input
        id={`${id}-time`}
        type="time"
        required
        value={time}
        onChange={(event) => {
          setTime(event.target.value);
        }}
      />
      <label htmlFor={`${id}-duration`}>Durée (minutes)</label>
      <input
        id={`${id}-duration`}
        type="number"
        min={15}
        max={240}
        step={5}
        value={duration}
        onChange={(event) => {
          setDuration(event.target.value);
        }}
      />
      {kind === "weekly" && (
        <>
          <label htmlFor={`${id}-until`}>Dernière séance au plus tard le</label>
          <input
            id={`${id}-until`}
            type="date"
            required
            value={until}
            onChange={(event) => {
              setUntil(event.target.value);
            }}
          />
        </>
      )}
      <label htmlFor={`${id}-link`}>Lien de visio (facultatif)</label>
      <input
        id={`${id}-link`}
        type="url"
        maxLength={500}
        placeholder="https://meet.google.com/… ou https://…zoom.us/…"
        value={link}
        onChange={(event) => {
          setLink(event.target.value);
        }}
      />
      <p className="hint">
        Laisse vide pour une salle Jitsi créée par Ardoiz, au nom impossible à deviner. Avec Zoom ou Meet,
        active la salle d'attente ou un mot de passe de salle : le lien n'est donné qu'aux élèves de la
        séance, 15 minutes avant le début.
      </p>
      <ErrorMessage error={plan.error} />
      {done && <p role="status">Séance planifiée.</p>}
      <button type="submit" className="button">
        Planifier
      </button>
    </form>
  );
}

function OccurrenceRow({ occurrence }: { readonly occurrence: Occurrence }) {
  const queryClient = useQueryClient();
  const id = useId();
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
  return (
    <li className="lesson-row">
      <span>
        {new Intl.DateTimeFormat("fr-FR", { dateStyle: "full", timeZone: "UTC" }).format(
          new Date(`${occurrence.local.date}T00:00:00Z`),
        )}{" "}
        {occurrence.local.start} – {occurrence.local.end}
      </span>
      {occurrence.status === "cancelled" ? (
        <span className="badge todo">annulée</span>
      ) : (
        <>
          {occurrence.moved && <span className="badge todo">déplacée</span>}
          <button
            type="button"
            className="button secondary"
            onClick={() => {
              setMoving(!moving);
            }}
          >
            Déplacer
          </button>
          <button
            type="button"
            className="button secondary"
            onClick={() => {
              if (window.confirm("Annuler cette séance ?")) cancel.mutate(false);
            }}
          >
            Annuler
          </button>
          <button
            type="button"
            className="button secondary"
            onClick={() => {
              if (window.confirm("Annuler cette séance et toutes les suivantes de la série ?"))
                cancel.mutate(true);
            }}
          >
            Annuler la suite
          </button>
        </>
      )}
      {moving && (
        <form
          className="inline"
          onSubmit={(event) => {
            event.preventDefault();
            move.mutate();
          }}
        >
          <label htmlFor={`${id}-date`}>Nouvelle date</label>
          <input
            id={`${id}-date`}
            type="date"
            value={date}
            onChange={(event) => {
              setDate(event.target.value);
            }}
          />
          <label htmlFor={`${id}-time`}>Heure</label>
          <input
            id={`${id}-time`}
            type="time"
            value={time}
            onChange={(event) => {
              setTime(event.target.value);
            }}
          />
          <button type="submit" className="button">
            Enregistrer
          </button>
        </form>
      )}
      <ErrorMessage error={move.error ?? cancel.error} />
    </li>
  );
}

/** Séances du tuteur (L5) : planifier, déplacer, annuler, changer le lien de visio (R9, M10, H8). */
export function TutorSessionsPage() {
  const queryClient = useQueryClient();
  const sessions = useQuery({ queryKey: SESSIONS, queryFn: fetchTutorSessions });
  const families = useQuery({ queryKey: ["families"], queryFn: fetchFamilies });
  const relink = useMutation({
    mutationFn: (sessionId: string) => changeSessionLink(sessionId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: SESSIONS }),
  });
  const nameOf = (learnerId: string) =>
    families.data?.learners.find((learner) => learner.id === learnerId)?.firstName ?? "Élève";
  return (
    <div className="stack wide">
      <section className="card wide">
        <h1>Séances</h1>
        <PlanForm />
      </section>
      {sessions.isPending && <p role="status">Chargement…</p>}
      <ErrorMessage error={sessions.error ?? relink.error} />
      {sessions.data?.sessions.map((session) => (
        <section key={session.id} className="card wide">
          <h2>{session.title}</h2>
          <p>
            Avec {session.learnerIds.map(nameOf).join(", ")} ·{" "}
            {session.kind === "weekly" ? "chaque semaine" : "une fois"}
          </p>
          <p>
            Lien : <code>{session.meetingLink}</code>{" "}
            <button
              type="button"
              className="button secondary"
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
            </button>
          </p>
          {session.occurrences.length === 0 ? (
            <p className="hint">Aucune séance à venir.</p>
          ) : (
            <ul className="lesson-list">
              {session.occurrences.map((occurrence) => (
                <OccurrenceRow key={occurrence.occurrenceId} occurrence={occurrence} />
              ))}
            </ul>
          )}
        </section>
      ))}
    </div>
  );
}
