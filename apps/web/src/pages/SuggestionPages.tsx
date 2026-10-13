import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useId, useState } from "react";
import { fetchSuggestions, handleSuggestion, sendSuggestion, type Suggestion } from "../api/progress";
import { ErrorMessage } from "../components/ErrorMessage";

/**
 * Suggestions des parents (R15). Le texte est affiché comme du TEXTE (nœud React), jamais comme du
 * HTML (R4) ; les retours à la ligne sont gardés par la feuille de style.
 */
const SUGGESTIONS_QUERY = ["suggestions"] as const;
const MAX_LENGTH = 2000;

export const CATEGORY_LABELS: Readonly<Record<Suggestion["category"], string>> = {
  lessons: "Les cours",
  sessions: "Les séances",
  assessments: "Les épreuves",
  other: "Autre",
};
const STATUS_LABELS: Readonly<Record<Suggestion["status"], string>> = {
  new: "Envoyée",
  read: "Lue par le tuteur",
  done: "Traitée",
};

const dateFr = (iso: string) =>
  new Intl.DateTimeFormat("fr-FR", { timeZone: "Europe/Paris", dateStyle: "medium" }).format(new Date(iso));

/** Le parent : écrire une suggestion, voir le statut et la réponse des siennes. */
export function GuardianSuggestions() {
  const queryClient = useQueryClient();
  const list = useQuery({ queryKey: SUGGESTIONS_QUERY, queryFn: fetchSuggestions });
  const [category, setCategory] = useState<Suggestion["category"]>("lessons");
  const [body, setBody] = useState("");
  const categoryId = useId();
  const bodyId = useId();
  const send = useMutation({
    mutationFn: () => sendSuggestion(category, body),
    onSuccess: async () => {
      setBody("");
      await queryClient.invalidateQueries({ queryKey: SUGGESTIONS_QUERY });
    },
  });
  return (
    <section className="card">
      <h2>Une suggestion pour le tuteur</h2>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          send.mutate();
        }}
      >
        <label htmlFor={categoryId}>Thème</label>
        <select
          id={categoryId}
          value={category}
          onChange={(event) => {
            const chosen = (Object.keys(CATEGORY_LABELS) as Array<Suggestion["category"]>).find(
              (key) => key === event.target.value,
            );
            if (chosen !== undefined) setCategory(chosen);
          }}
        >
          {Object.entries(CATEGORY_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        <label htmlFor={bodyId}>Ta suggestion (texte simple, {MAX_LENGTH} caractères au plus)</label>
        <textarea
          id={bodyId}
          value={body}
          maxLength={MAX_LENGTH}
          rows={5}
          required
          onChange={(event) => {
            setBody(event.target.value);
          }}
        />
        <p className="hint" aria-live="polite">
          {body.length} / {MAX_LENGTH}
        </p>
        <button type="submit" className="button" disabled={send.isPending}>
          Envoyer
        </button>
        {send.isSuccess && <p role="status">Suggestion envoyée. Merci !</p>}
        <ErrorMessage error={send.error} />
      </form>
      <h3>Mes suggestions</h3>
      <ErrorMessage error={list.error} />
      {list.data?.suggestions.length === 0 && <p className="hint">Tu n'as encore rien envoyé.</p>}
      <ul className="suggestions">
        {list.data?.suggestions.map((suggestion) => (
          <li key={suggestion.id}>
            <p>
              <strong>{CATEGORY_LABELS[suggestion.category]}</strong> · {dateFr(suggestion.createdAt)} ·{" "}
              {STATUS_LABELS[suggestion.status]}
            </p>
            <p className="suggestion-body">{suggestion.body}</p>
            {suggestion.reply !== null && (
              <p className="suggestion-body">
                <strong>Réponse du tuteur :</strong> {suggestion.reply}
              </p>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Le tuteur : la boîte de réception des suggestions, avec statut et réponse courte. */
export function SuggestionsInboxPage() {
  const list = useQuery({ queryKey: SUGGESTIONS_QUERY, queryFn: fetchSuggestions });
  return (
    <section className="card">
      <h1>Suggestions des parents</h1>
      {list.isPending && <p role="status">Chargement…</p>}
      <ErrorMessage error={list.error} />
      {list.data?.suggestions.length === 0 && <p className="hint">Aucune suggestion pour l'instant.</p>}
      <ul className="suggestions">
        {list.data?.suggestions.map((suggestion) => (
          <li key={suggestion.id}>
            <InboxEntry suggestion={suggestion} />
          </li>
        ))}
      </ul>
    </section>
  );
}

function InboxEntry({ suggestion }: { readonly suggestion: Suggestion }) {
  const queryClient = useQueryClient();
  const [reply, setReply] = useState(suggestion.reply ?? "");
  const replyId = useId();
  const update = useMutation({
    mutationFn: (status: "read" | "done") => handleSuggestion(suggestion.id, status, reply),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: SUGGESTIONS_QUERY }),
  });
  return (
    <article>
      <p>
        <strong>{CATEGORY_LABELS[suggestion.category]}</strong> · {dateFr(suggestion.createdAt)} ·{" "}
        {STATUS_LABELS[suggestion.status]}
      </p>
      <p className="suggestion-body">{suggestion.body}</p>
      <label htmlFor={replyId}>Réponse courte (500 caractères au plus, facultative)</label>
      <textarea
        id={replyId}
        value={reply}
        maxLength={500}
        rows={2}
        onChange={(event) => {
          setReply(event.target.value);
        }}
      />
      <div className="actions">
        <button
          type="button"
          className="button secondary"
          onClick={() => {
            update.mutate("read");
          }}
        >
          Marquer comme lue
        </button>
        <button
          type="button"
          className="button"
          onClick={() => {
            update.mutate("done");
          }}
        >
          Marquer comme traitée
        </button>
      </div>
      <ErrorMessage error={update.error} />
    </article>
  );
}
