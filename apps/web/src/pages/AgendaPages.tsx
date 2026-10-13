import { useMutation, useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { fetchAgenda, joinOccurrence, type Occurrence } from "../api/scheduling";
import { ErrorMessage } from "../components/ErrorMessage";

/** Heure de l'appareil, rafraîchie toutes les 30 s : le bouton « Rejoindre » s'active sans recharger. */
export function useNow(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => {
      setNow(Date.now());
    }, 30_000);
    return () => {
      clearInterval(timer);
    };
  }, []);
  return now;
}

/** Date du jour à Paris (H8), au format AAAA-MM-JJ. */
export function parisToday(now = new Date()): string {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Paris" }).format(now);
}

/** Lundi de la semaine d'une date locale, décalé de `weeks` semaines. */
export function mondayOf(date: string, weeks = 0): string {
  const [y = 0, m = 1, d = 1] = date.split("-").map(Number);
  const day = new Date(Date.UTC(y, m - 1, d));
  const shift = (day.getUTCDay() + 6) % 7;
  return new Date(Date.UTC(y, m - 1, d - shift + weeks * 7)).toISOString().slice(0, 10);
}

const dayLabel = (date: string) =>
  new Intl.DateTimeFormat("fr-FR", {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: "UTC",
  }).format(new Date(`${date}T00:00:00Z`));

/**
 * Bouton « Rejoindre » d'un élève (R9) : actif de 15 min avant le début jusqu'à la fin, d'après
 * l'horloge de l'appareil pour l'affichage seulement — le SERVEUR décide. Le lien n'est demandé qu'au
 * clic, ce qui note la présence ; il s'ouvre dans un nouvel onglet, sans lien avec Ardoiz.
 */
function JoinButton({ occurrence, now }: { readonly occurrence: Occurrence; readonly now: number }) {
  const join = useMutation({ mutationFn: () => joinOccurrence(occurrence.occurrenceId) });
  const open =
    occurrence.status === "scheduled" &&
    now >= Date.parse(occurrence.linkAvailableFrom) &&
    now < Date.parse(occurrence.endsAt);
  if (join.data !== undefined) {
    return (
      <a className="button" href={join.data.meetingLink} target="_blank" rel="noopener noreferrer">
        Ouvrir la salle de visio
      </a>
    );
  }
  return (
    <>
      <button
        type="button"
        className="button"
        disabled={!open || join.isPending}
        onClick={() => {
          join.mutate();
        }}
      >
        Rejoindre
      </button>
      {!open && occurrence.status === "scheduled" && (
        <span className="hint">
          Le bouton s'active à{" "}
          {new Intl.DateTimeFormat("fr-FR", { timeStyle: "short", timeZone: "Europe/Paris" }).format(
            new Date(occurrence.linkAvailableFrom),
          )}
          .
        </span>
      )}
      <ErrorMessage error={join.error} />
    </>
  );
}

/**
 * Agenda de l'élève ou du parent (L5), semaine par semaine, en heure de Paris (H8). Il ne contient
 * jamais de lien de visio (R9) ; le parent voit les séances de ses enfants, sans pouvoir les rejoindre.
 */
export function Agenda({
  canJoin,
  nameOf,
}: {
  readonly canJoin: boolean;
  /** Prénom d'un enfant participant (vue parent). */
  readonly nameOf?: (learnerId: string) => string;
}) {
  const [week, setWeek] = useState(0);
  const from = mondayOf(parisToday(), week);
  const agenda = useQuery({ queryKey: ["agenda", from], queryFn: () => fetchAgenda(from, 7) });
  const now = useNow();
  const byDay = new Map<string, Occurrence[]>();
  for (const occurrence of agenda.data?.occurrences ?? []) {
    byDay.set(occurrence.local.date, [...(byDay.get(occurrence.local.date) ?? []), occurrence]);
  }
  return (
    <div className="stack">
      <div className="actions" role="group" aria-label="Semaine affichée">
        <button
          type="button"
          className="button secondary"
          onClick={() => {
            setWeek(week - 1);
          }}
        >
          Semaine précédente
        </button>
        <span>Semaine du {dayLabel(from)}</span>
        <button
          type="button"
          className="button secondary"
          onClick={() => {
            setWeek(week + 1);
          }}
        >
          Semaine suivante
        </button>
      </div>
      {agenda.isPending && <p role="status">Chargement…</p>}
      <ErrorMessage error={agenda.error} />
      {agenda.data?.occurrences.length === 0 && <p>Aucune séance cette semaine.</p>}
      {[...byDay.entries()].map(([date, occurrences]) => (
        <section key={date} aria-label={dayLabel(date)}>
          <h3>{dayLabel(date)}</h3>
          <ul className="lesson-list">
            {occurrences.map((occurrence) => (
              <li key={occurrence.occurrenceId} className="lesson-row">
                <span>
                  <strong>
                    {occurrence.local.start} – {occurrence.local.end}
                  </strong>{" "}
                  {occurrence.title}
                  {nameOf !== undefined && occurrence.participantIds.length > 0 && (
                    <> ({occurrence.participantIds.map(nameOf).join(", ")})</>
                  )}
                </span>
                {occurrence.status === "cancelled" && <span className="badge todo">annulée</span>}
                {occurrence.moved && occurrence.status === "scheduled" && (
                  <span className="badge todo">déplacée</span>
                )}
                {canJoin && <JoinButton occurrence={occurrence} now={now} />}
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
