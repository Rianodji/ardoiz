import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useId, useState } from "react";
import { fetchFamilies } from "../api/identity";
import { fetchSuggestions, handleSuggestion, sendSuggestion, type Suggestion } from "../api/progress";
import { ErrorMessage } from "../components/ErrorMessage";
import { Button, Card, Field, Notice, PageHeader, Pill, type PillTone } from "../ui";
import { shortDate } from "../ui/format";
import { MessageSquare } from "../ui/icons";

/**
 * Suggestions des parents (R15). Le texte est affiché comme du TEXTE (nœud React), jamais comme du
 * HTML (R4) ; les retours à la ligne sont gardés par la feuille de style.
 */
const SUGGESTIONS_QUERY = ["suggestions"] as const;
const MAX_LENGTH = 2000;
const REPLY_MAX_LENGTH = 500;

export const CATEGORY_LABELS: Readonly<Record<Suggestion["category"], string>> = {
  lessons: "Les cours",
  sessions: "Les séances",
  assessments: "Les devoirs",
  other: "Autre chose",
};
const CATEGORIES = Object.keys(CATEGORY_LABELS) as Array<Suggestion["category"]>;

const STATUS: Readonly<Record<Suggestion["status"], { label: string; tone: PillTone }>> = {
  new: { label: "Envoyée", tone: "todo" },
  read: { label: "Lue par le tuteur", tone: "info" },
  done: { label: "Traitée", tone: "done" },
};

const count = (value: number) => value.toLocaleString("fr-FR");

/** Le parent : écrire au tuteur, voir le statut et la réponse de ses messages (maquette Parent-Suggestion). */
export function GuardianSuggestionsPage() {
  const queryClient = useQueryClient();
  const list = useQuery({ queryKey: SUGGESTIONS_QUERY, queryFn: fetchSuggestions });
  const [category, setCategory] = useState<Suggestion["category"]>("lessons");
  const [body, setBody] = useState("");
  const groupId = useId();
  const send = useMutation({
    mutationFn: () => sendSuggestion(category, body),
    onSuccess: async () => {
      setBody("");
      await queryClient.invalidateQueries({ queryKey: SUGGESTIONS_QUERY });
    },
  });
  return (
    <div className="page">
      <div className="grid-two">
        <Card aria-labelledby="ecrire">
          <h1 id="ecrire">Écrire au tuteur</h1>
          <p>Une idée, une remarque, un souci ? Le tuteur lit chaque message et vous répond ici.</p>
          <form
            className="form-stack"
            onSubmit={(event) => {
              event.preventDefault();
              send.mutate();
            }}
          >
            <fieldset>
              <legend id={groupId}>Le sujet</legend>
              <div className="choice-group">
                {CATEGORIES.map((key) => (
                  <label key={key}>
                    <input
                      type="radio"
                      name="sujet"
                      value={key}
                      checked={category === key}
                      onChange={() => {
                        setCategory(key);
                      }}
                    />
                    {CATEGORY_LABELS[key]}
                  </label>
                ))}
              </div>
            </fieldset>
            <Field
              label="Votre message"
              hint={
                <span className="char-count">
                  <span>Texte simple, sans mise en forme.</span>
                  <span aria-live="polite">
                    {count(body.length)} / {count(MAX_LENGTH)}
                  </span>
                </span>
              }
            >
              {(control) => (
                <textarea
                  {...control}
                  value={body}
                  maxLength={MAX_LENGTH}
                  rows={5}
                  required
                  onChange={(event) => {
                    setBody(event.target.value);
                  }}
                />
              )}
            </Field>
            <div>
              <Button type="submit" disabled={send.isPending}>
                Envoyer au tuteur
              </Button>
            </div>
            {send.isSuccess && (
              <p role="status" className="status-line">
                Message envoyé. Merci !
              </p>
            )}
            <ErrorMessage error={send.error} />
            <p className="hint">Jusqu'à 5 messages par jour.</p>
          </form>
        </Card>
        <section aria-labelledby="vos-messages" className="stack-sm">
          <h2 id="vos-messages">Vos messages</h2>
          <ErrorMessage error={list.error} />
          {list.data?.suggestions.length === 0 && <p className="hint">Vous n'avez encore rien envoyé.</p>}
          <ul className="stack-sm plain">
            {list.data?.suggestions.map((suggestion) => (
              <li key={suggestion.id} className="card">
                <p className="row-side">
                  <Pill tone={STATUS[suggestion.status].tone}>{STATUS[suggestion.status].label}</Pill>
                  <span className="hint">
                    {CATEGORY_LABELS[suggestion.category]} · {shortDate(suggestion.createdAt)}
                  </span>
                </p>
                <p className="suggestion-body">{suggestion.body}</p>
                {suggestion.reply !== null && (
                  <div className="reply">
                    <p className="reply-label">Réponse du tuteur</p>
                    <p className="suggestion-body">{suggestion.reply}</p>
                  </div>
                )}
              </li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  );
}

const FILTERS = [
  { key: "new", label: "À traiter" },
  { key: "read", label: "Lues" },
  { key: "done", label: "Traitées" },
] as const;

/** Le tuteur : la boîte de réception des suggestions, filtrée par état (maquette Tuteur-Suggestions). */
export function SuggestionsInboxPage() {
  const list = useQuery({ queryKey: SUGGESTIONS_QUERY, queryFn: fetchSuggestions });
  const families = useQuery({ queryKey: ["families"], queryFn: fetchFamilies });
  const [filter, setFilter] = useState<Suggestion["status"]>("new");
  const all = list.data?.suggestions ?? [];
  const shown = all.filter((suggestion) => suggestion.status === filter);
  // L'auteur, retrouvé dans les familles de l'espace : « Awa Mbaye · parent de Lina et Adam ».
  const authorOf = (guardianId: string) => {
    const guardian = families.data?.guardians.find((entry) => entry.id === guardianId);
    const children = (families.data?.learners ?? [])
      .filter((learner) => learner.guardians.some((link) => link.guardianId === guardianId))
      .map((learner) => learner.firstName);
    return {
      name: guardian?.displayName ?? "Un parent",
      children: children.length === 0 ? "" : `parent de ${children.join(" et ")}`,
    };
  };
  return (
    <div className="page">
      <PageHeader title="Suggestions des parents" />
      <div className="choice-group green" role="radiogroup" aria-label="Afficher les suggestions">
        {FILTERS.map((entry) => (
          <label key={entry.key}>
            <input
              type="radio"
              name="filtre"
              checked={filter === entry.key}
              onChange={() => {
                setFilter(entry.key);
              }}
            />
            {entry.label} ({all.filter((suggestion) => suggestion.status === entry.key).length})
          </label>
        ))}
      </div>
      <div className="stack" aria-live="polite">
        {list.isPending && <p role="status">Chargement…</p>}
        <ErrorMessage error={list.error} />
        {list.data !== undefined && shown.length === 0 && (
          <Notice icon={MessageSquare}>Aucune suggestion dans cette liste.</Notice>
        )}
        <ul className="stack plain">
          {shown.map((suggestion) => (
            <li key={suggestion.id}>
              <InboxEntry suggestion={suggestion} author={authorOf(suggestion.guardianId)} />
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function InboxEntry({
  suggestion,
  author,
}: {
  readonly suggestion: Suggestion;
  readonly author: { readonly name: string; readonly children: string };
}) {
  const queryClient = useQueryClient();
  const [reply, setReply] = useState(suggestion.reply ?? "");
  const update = useMutation({
    mutationFn: (status: "read" | "done") => handleSuggestion(suggestion.id, status, reply),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: SUGGESTIONS_QUERY }),
  });
  return (
    <Card as="article" className={suggestion.status === "new" ? "highlight" : undefined}>
      <p className="row-side">
        {suggestion.status === "new" ? (
          <Pill tone="todo">Nouvelle</Pill>
        ) : (
          <Pill tone={STATUS[suggestion.status].tone}>
            {suggestion.status === "read" ? "Lue" : "Traitée"}
          </Pill>
        )}
        <strong>{author.name}</strong>
        <span className="hint">
          {author.children === "" ? "" : `${author.children} · `}
          {CATEGORY_LABELS[suggestion.category]} · {shortDate(suggestion.createdAt)}
        </span>
      </p>
      <p className="suggestion-body">{suggestion.body}</p>
      <form
        className="form-stack"
        onSubmit={(event) => {
          event.preventDefault();
          update.mutate("done");
        }}
      >
        <Field label={`Répondre (facultatif, ${String(REPLY_MAX_LENGTH)} caractères au plus)`}>
          {(control) => (
            <textarea
              {...control}
              value={reply}
              maxLength={REPLY_MAX_LENGTH}
              rows={2}
              placeholder="Votre réponse au parent"
              onChange={(event) => {
                setReply(event.target.value);
              }}
            />
          )}
        </Field>
        <div className="actions">
          <Button type="submit" disabled={update.isPending}>
            {reply.trim() === "" ? "Marquer comme traitée" : "Répondre et marquer comme traitée"}
          </Button>
          {suggestion.status === "new" && (
            <Button
              variant="secondary"
              disabled={update.isPending}
              onClick={() => {
                update.mutate("read");
              }}
            >
              Marquer comme lue
            </Button>
          )}
        </div>
        <ErrorMessage error={update.error} />
      </form>
    </Card>
  );
}
