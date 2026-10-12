import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useId, useState } from "react";
import { Link } from "react-router";
import {
  addCompetency,
  archiveCompetency,
  createGroup,
  createLesson,
  createModule,
  fetchGroups,
  fetchProgramme,
  fetchReferential,
  fetchUnlocks,
  publishLesson,
  relock,
  setGroupMembers,
  unlockContent,
  unpublishLesson,
  updateCompetency,
} from "../api/curriculum";
import { fetchFamilies } from "../api/identity";
import { ErrorMessage } from "../components/ErrorMessage";

/** Petit formulaire « un champ + un bouton », réutilisé pour créer un module, un cours, un groupe, une compétence. */
function QuickAdd({
  label,
  button,
  onAdd,
}: {
  readonly label: string;
  readonly button: string;
  readonly onAdd: (value: string) => Promise<unknown>;
}) {
  const [value, setValue] = useState("");
  const [error, setError] = useState<unknown>(null);
  const id = useId();
  return (
    <form
      className="quick-add"
      onSubmit={(event) => {
        event.preventDefault();
        void (async () => {
          try {
            await onAdd(value);
            setValue("");
            setError(null);
          } catch (caught) {
            setError(caught);
          }
        })();
      }}
    >
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        value={value}
        onChange={(event) => {
          setValue(event.target.value);
        }}
        required
      />
      <button type="submit" className="button">
        {button}
      </button>
      <ErrorMessage error={error} />
    </form>
  );
}

/** Déverrouiller un module ou un cours pour un élève ou un groupe (R3) ; reverrouiller. */
function UnlockControls({ target }: { readonly target: { kind: "module" | "lesson"; id: string } }) {
  const queryClient = useQueryClient();
  const groups = useQuery({ queryKey: ["groups"], queryFn: fetchGroups });
  const families = useQuery({ queryKey: ["families"], queryFn: fetchFamilies });
  const unlocks = useQuery({ queryKey: ["unlocks"], queryFn: fetchUnlocks });
  const [audience, setAudience] = useState("");
  const selectId = useId();
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["unlocks"] });
  const unlock = useMutation({
    mutationFn: () => {
      const [kind = "", id = ""] = audience.split(":");
      return unlockContent(target, { kind: kind === "group" ? "group" : "learner", id });
    },
    onSuccess: refresh,
  });
  const lock = useMutation({ mutationFn: relock, onSuccess: refresh });
  const nameOf = (kind: string, id: string): string =>
    kind === "group"
      ? (groups.data?.groups.find((group) => group.id === id)?.name ?? "groupe")
      : (families.data?.learners.find((learner) => learner.id === id)?.firstName ?? "élève");
  const active = unlocks.data?.unlocks.filter((candidate) => candidate.target.id === target.id) ?? [];

  return (
    <div className="unlocks">
      <p className="hint">
        Ouvert pour :{" "}
        {active.length === 0
          ? "personne"
          : active.map((candidate) => (
              <span key={candidate.id} className="chip">
                {nameOf(candidate.audience.kind, candidate.audience.id)}{" "}
                <button
                  type="button"
                  className="link-button"
                  onClick={() => {
                    lock.mutate(candidate.id);
                  }}
                >
                  reverrouiller
                </button>
              </span>
            ))}
      </p>
      <form
        className="inline"
        onSubmit={(event) => {
          event.preventDefault();
          if (audience !== "") unlock.mutate();
        }}
      >
        <label htmlFor={selectId}>Déverrouiller pour</label>
        <select
          id={selectId}
          value={audience}
          onChange={(event) => {
            setAudience(event.target.value);
          }}
        >
          <option value="">— choisir —</option>
          {groups.data?.groups.map((group) => (
            <option key={group.id} value={`group:${group.id}`}>
              Groupe {group.name}
            </option>
          ))}
          {families.data?.learners.map((learner) => (
            <option key={learner.id} value={`learner:${learner.id}`}>
              {learner.firstName}
            </option>
          ))}
        </select>
        <button type="submit" className="button" disabled={audience === ""}>
          Déverrouiller
        </button>
      </form>
      <ErrorMessage error={unlock.error ?? lock.error} />
    </div>
  );
}

/** Programme du tuteur : matières, modules, cours (brouillon / publié), déverrouillages. */
export function TutorProgrammePage() {
  const queryClient = useQueryClient();
  const programme = useQuery({ queryKey: ["programme"], queryFn: fetchProgramme });
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["programme"] });
  const toggle = useMutation({
    mutationFn: ({ id, published }: { id: string; published: boolean }) =>
      published ? unpublishLesson(id) : publishLesson(id),
    onSuccess: refresh,
  });

  if (programme.isPending) return <p role="status">Chargement…</p>;
  if (programme.isError) return <ErrorMessage error={programme.error} />;
  const { subjects, modules, lessons } = programme.data;
  return (
    <div className="stack wide">
      <section className="card wide">
        <h1>Programme</h1>
        <p className="hint">
          Un cours n'est visible par un élève que s'il est <strong>publié</strong> et{" "}
          <strong>déverrouillé</strong> pour lui ou son groupe.
        </p>
        <ErrorMessage error={toggle.error} />
      </section>
      {subjects.map((subject) => (
        <section key={subject.id} className="card wide">
          <h2>{subject.name}</h2>
          {modules
            .filter((module) => module.subjectId === subject.id)
            .map((module) => (
              <div key={module.id} className="module">
                <h3>{module.title}</h3>
                <UnlockControls target={{ kind: "module", id: module.id }} />
                <ul className="lesson-list">
                  {lessons
                    .filter((lesson) => lesson.moduleId === module.id)
                    .map((lesson) => (
                      <li key={lesson.id}>
                        <div className="lesson-row">
                          <Link to={`/tuteur/cours/${lesson.id}`}>{lesson.title}</Link>
                          <span className={`badge ${lesson.status === "published" ? "done" : "todo"}`}>
                            {lesson.status === "published" ? "publié" : "brouillon"}
                          </span>
                          <button
                            type="button"
                            className="link-button"
                            onClick={() => {
                              toggle.mutate({ id: lesson.id, published: lesson.status === "published" });
                            }}
                          >
                            {lesson.status === "published" ? "Repasser en brouillon" : "Publier"}
                          </button>
                        </div>
                        <UnlockControls target={{ kind: "lesson", id: lesson.id }} />
                      </li>
                    ))}
                </ul>
                <QuickAdd
                  label="Nouveau cours"
                  button="Créer le cours"
                  onAdd={(title) => createLesson(module.id, title).then(refresh)}
                />
              </div>
            ))}
          <QuickAdd
            label="Nouveau module"
            button="Créer le module"
            onAdd={(title) => createModule(subject.id, title).then(refresh)}
          />
        </section>
      ))}
    </div>
  );
}

/** Référentiel de compétences : ajouter, renommer, réordonner, archiver ; le code ne change jamais. */
export function ReferentialPage() {
  const queryClient = useQueryClient();
  const referential = useQuery({ queryKey: ["referential"], queryFn: fetchReferential });
  const [error, setError] = useState<unknown>(null);
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["referential"] });
  const act = (work: () => Promise<unknown>) => {
    setError(null);
    void work()
      .then(refresh)
      .catch((caught: unknown) => {
        setError(caught);
      });
  };

  if (referential.isPending) return <p role="status">Chargement…</p>;
  if (referential.isError) return <ErrorMessage error={referential.error} />;
  const { subjects, domains, competencies } = referential.data;
  return (
    <section className="card wide">
      <h1>Référentiel de compétences</h1>
      <p className="hint">
        Une compétence archivée n'est plus proposée pour les nouvelles épreuves, mais l'historique des élèves
        reste lisible. Elle ne peut jamais être supprimée.
      </p>
      <ErrorMessage error={error} />
      {subjects.map((subject) => (
        <div key={subject.id}>
          <h2>{subject.name}</h2>
          {domains
            .filter((domain) => domain.subjectId === subject.id)
            .map((domain) => {
              const items = competencies
                .filter((competency) => competency.domainId === domain.id)
                .sort((a, b) => a.position - b.position);
              return (
                <div key={domain.id} className="domain">
                  <h3>{domain.label}</h3>
                  <ol className="competencies">
                    {items.map((competency, index) => (
                      <li key={competency.id} className={competency.archivedAt === null ? "" : "archived"}>
                        <code>{competency.code}</code> {competency.label}
                        {competency.archivedAt === null ? (
                          <span className="actions">
                            <button
                              type="button"
                              className="link-button"
                              disabled={index === 0}
                              onClick={() => {
                                act(() =>
                                  updateCompetency(competency.id, {
                                    position: Math.max(0, competency.position - 1),
                                  }),
                                );
                              }}
                            >
                              monter
                            </button>
                            <button
                              type="button"
                              className="link-button"
                              onClick={() => {
                                const label = window.prompt("Nouveau libellé", competency.label);
                                if (label !== null && label.trim() !== "")
                                  act(() => updateCompetency(competency.id, { label }));
                              }}
                            >
                              renommer
                            </button>
                            <button
                              type="button"
                              className="link-button"
                              onClick={() => {
                                act(() => archiveCompetency(competency.id));
                              }}
                            >
                              archiver
                            </button>
                          </span>
                        ) : (
                          <span className="badge todo">archivée</span>
                        )}
                      </li>
                    ))}
                  </ol>
                  <QuickAdd
                    label={`Nouvelle compétence (${domain.prefix})`}
                    button="Ajouter"
                    onAdd={(label) => addCompetency(domain.id, label).then(refresh)}
                  />
                </div>
              );
            })}
        </div>
      ))}
    </section>
  );
}

/** Groupes d'élèves (« Neveux 5e ») : leurs membres reçoivent les déverrouillages du groupe. */
export function GroupsPage() {
  const queryClient = useQueryClient();
  const groups = useQuery({ queryKey: ["groups"], queryFn: fetchGroups });
  const families = useQuery({ queryKey: ["families"], queryFn: fetchFamilies });
  const members = useMutation({
    mutationFn: ({ id, learnerIds }: { id: string; learnerIds: string[] }) => setGroupMembers(id, learnerIds),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["groups"] }),
  });
  return (
    <section className="card wide">
      <h1>Groupes</h1>
      <QuickAdd
        label="Nouveau groupe"
        button="Créer le groupe"
        onAdd={(name) =>
          createGroup(name).then(() => queryClient.invalidateQueries({ queryKey: ["groups"] }))
        }
      />
      <ErrorMessage error={groups.error ?? members.error} />
      {groups.data?.groups.map((group) => (
        <fieldset key={group.id}>
          <legend>{group.name}</legend>
          {families.data?.learners.map((learner) => {
            const checked = group.learnerIds.includes(learner.id);
            return (
              <label key={learner.id} className="checkbox-line">
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
                />{" "}
                {learner.firstName}
              </label>
            );
          })}
        </fieldset>
      ))}
    </section>
  );
}
