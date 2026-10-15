import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import {
  addCompetency,
  archiveCompetency,
  createLesson,
  createModule,
  fetchGroups,
  fetchProgramme,
  fetchReferential,
  fetchUnlocks,
  publishLesson,
  relock,
  unlockContent,
  unpublishLesson,
  updateCompetency,
} from "../api/curriculum";
import { fetchFamilies } from "../api/identity";
import { ErrorMessage } from "../components/ErrorMessage";
import { Button, ButtonLink, Card, Field, Notice, PageHeader, Pill, TableBox, Tabs } from "../ui";
import { plural } from "../ui/format";
import { Archive, ArrowUp, Check, Pencil, X } from "../ui/icons";

/** Petit formulaire « un champ + un bouton » : créer un module, un cours, une compétence. */
function QuickAdd({
  label,
  button,
  placeholder,
  onAdd,
}: {
  readonly label: string;
  readonly button: string;
  readonly placeholder?: string;
  readonly onAdd: (value: string) => Promise<unknown>;
}) {
  const [value, setValue] = useState("");
  const [error, setError] = useState<unknown>(null);
  return (
    <form
      className="inline quick-add"
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
      <Field label={label} className="grow">
        {(control) => (
          <input
            {...control}
            value={value}
            {...(placeholder === undefined ? {} : { placeholder })}
            onChange={(event) => {
              setValue(event.target.value);
            }}
            required
          />
        )}
      </Field>
      <Button type="submit">{button}</Button>
      <ErrorMessage error={error} />
    </form>
  );
}

/** À qui un module ou un cours est ouvert ; ouvrir à un élève ou un groupe, refermer (R3). */
function useAudiences() {
  const groups = useQuery({ queryKey: ["groups"], queryFn: fetchGroups });
  const families = useQuery({ queryKey: ["families"], queryFn: fetchFamilies });
  const unlocks = useQuery({ queryKey: ["unlocks"], queryFn: fetchUnlocks });
  const nameOf = (kind: string, id: string): string =>
    kind === "group"
      ? `groupe ${groups.data?.groups.find((group) => group.id === id)?.name ?? ""}`
      : (families.data?.learners.find((learner) => learner.id === id)?.firstName ?? "élève");
  const of = (targetId: string) =>
    unlocks.data?.unlocks.filter((candidate) => candidate.target.id === targetId) ?? [];
  return { groups, families, nameOf, of };
}

function AudiencePill({ targetId }: { readonly targetId: string }) {
  const { nameOf, of } = useAudiences();
  const active = of(targetId);
  return (
    <Pill tone="neutral">
      {active.length === 0
        ? "Ouvert à personne"
        : `Ouvert à : ${active.map((unlock) => nameOf(unlock.audience.kind, unlock.audience.id)).join(", ")}`}
    </Pill>
  );
}

function UnlockPanel({
  target,
  title,
  onClose,
}: {
  readonly target: { kind: "module" | "lesson"; id: string };
  readonly title: string;
  readonly onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const { groups, families, nameOf, of } = useAudiences();
  const [audience, setAudience] = useState("");
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["unlocks"] });
  const unlock = useMutation({
    mutationFn: () => {
      const [kind = "", id = ""] = audience.split(":");
      return unlockContent(target, { kind: kind === "group" ? "group" : "learner", id });
    },
    onSuccess: async () => {
      setAudience("");
      await refresh();
    },
  });
  const lock = useMutation({ mutationFn: relock, onSuccess: refresh });
  const active = of(target.id);
  return (
    <div className="card dashed stack-sm" role="group" aria-label={`Ouvrir « ${title} »`}>
      <p className="row-title">Ouvrir « {title} »</p>
      {active.length === 0 ? (
        <p className="hint">Personne ne le voit encore.</p>
      ) : (
        <ul className="actions plain">
          {active.map((candidate) => {
            const name = nameOf(candidate.audience.kind, candidate.audience.id);
            return (
              <li key={candidate.id} className="chip">
                {name}
                <Button
                  variant="quiet"
                  aria-label={`Refermer pour ${name}`}
                  onClick={() => {
                    lock.mutate(candidate.id);
                  }}
                >
                  refermer
                </Button>
              </li>
            );
          })}
        </ul>
      )}
      <form
        className="inline"
        onSubmit={(event) => {
          event.preventDefault();
          if (audience !== "") unlock.mutate();
        }}
      >
        <Field label="Ouvrir pour" className="grow">
          {(control) => (
            <select
              {...control}
              value={audience}
              onChange={(event) => {
                setAudience(event.target.value);
              }}
            >
              <option value="">Choisir…</option>
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
          )}
        </Field>
        <Button type="submit" disabled={audience === "" || unlock.isPending}>
          Ouvrir
        </Button>
        <Button variant="quiet" onClick={onClose}>
          Fermer
        </Button>
      </form>
      <ErrorMessage error={unlock.error ?? lock.error} />
    </div>
  );
}

/**
 * Programme du tuteur (maquette Tuteur-Programme) : un onglet par matière ; dans chaque module, les
 * cours avec leur état (brouillon, publié) et leur public ; ajout d'un module en bas de liste.
 */
export function TutorProgrammePage() {
  const queryClient = useQueryClient();
  const programme = useQuery({ queryKey: ["programme"], queryFn: fetchProgramme });
  const [subjectId, setSubjectId] = useState<string | null>(null);
  const [opened, setOpened] = useState<string | null>(null);
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["programme"] });
  const toggle = useMutation({
    mutationFn: ({ id, published }: { id: string; published: boolean }) =>
      published ? unpublishLesson(id) : publishLesson(id),
    onSuccess: refresh,
  });

  if (programme.isPending) return <p role="status">Chargement…</p>;
  if (programme.isError) return <ErrorMessage error={programme.error} />;
  const { subjects, modules, lessons } = programme.data;
  const subject = subjects.find((candidate) => candidate.id === subjectId) ?? subjects[0];
  return (
    <div className="page">
      <PageHeader
        title="Programme"
        lead="Un cours n'apparaît chez un élève que s'il est publié et ouvert pour lui ou son groupe."
      />
      <ErrorMessage error={toggle.error} />
      {subject === undefined ? (
        <Notice>Aucune matière pour l'instant.</Notice>
      ) : (
        <Tabs
          label="Matières"
          tabs={subjects.map((candidate) => ({ key: candidate.id, label: candidate.name }))}
          selected={subject.id}
          onSelect={setSubjectId}
        >
          <div className="stack">
            {modules
              .filter((module) => module.subjectId === subject.id)
              .sort((a, b) => a.position - b.position)
              .map((module) => {
                const items = lessons
                  .filter((lesson) => lesson.moduleId === module.id)
                  .sort((a, b) => a.position - b.position);
                return (
                  <Card key={module.id} aria-labelledby={`module-${module.id}`}>
                    <div className="card-head">
                      <h2 id={`module-${module.id}`}>{module.title}</h2>
                      <div className="row-side">
                        <span className="hint">{plural(items.length, "cours", "cours")}</span>
                        <AudiencePill targetId={module.id} />
                        <Button
                          variant="secondary"
                          aria-expanded={opened === module.id}
                          aria-label={`Ouvrir le module ${module.title} à…`}
                          onClick={() => {
                            setOpened(opened === module.id ? null : module.id);
                          }}
                        >
                          Ouvrir à…
                        </Button>
                      </div>
                    </div>
                    {opened === module.id && (
                      <UnlockPanel
                        target={{ kind: "module", id: module.id }}
                        title={module.title}
                        onClose={() => {
                          setOpened(null);
                        }}
                      />
                    )}
                    <ul className="boxed-rows">
                      {items.map((lesson) => (
                        <li key={lesson.id}>
                          <div className="row-main">
                            <p className="row-title">{lesson.title}</p>
                          </div>
                          <div className="row-side">
                            {lesson.status === "published" ? (
                              <Pill tone="done" icon={Check}>
                                Publié
                              </Pill>
                            ) : (
                              <Pill tone="todo" icon={Pencil}>
                                Brouillon
                              </Pill>
                            )}
                            <AudiencePill targetId={lesson.id} />
                            <ButtonLink
                              to={`/tuteur/cours/${lesson.id}`}
                              variant="secondary"
                              aria-label={`Modifier ${lesson.title}`}
                            >
                              Modifier
                            </ButtonLink>
                            <Button
                              variant="secondary"
                              aria-label={`${lesson.status === "published" ? "Repasser en brouillon" : "Publier"} : ${lesson.title}`}
                              onClick={() => {
                                toggle.mutate({ id: lesson.id, published: lesson.status === "published" });
                              }}
                            >
                              {lesson.status === "published" ? "Repasser en brouillon" : "Publier"}
                            </Button>
                            <Button
                              variant="secondary"
                              aria-expanded={opened === lesson.id}
                              aria-label={`Ouvrir ${lesson.title} à…`}
                              onClick={() => {
                                setOpened(opened === lesson.id ? null : lesson.id);
                              }}
                            >
                              Ouvrir à…
                            </Button>
                          </div>
                          {opened === lesson.id && (
                            <UnlockPanel
                              target={{ kind: "lesson", id: lesson.id }}
                              title={lesson.title}
                              onClose={() => {
                                setOpened(null);
                              }}
                            />
                          )}
                        </li>
                      ))}
                    </ul>
                    <div className="section-gap">
                      <QuickAdd
                        label={`Nouveau cours dans « ${module.title} »`}
                        button="Créer le cours"
                        placeholder="Par exemple : Les fractions"
                        onAdd={(title) => createLesson(module.id, title).then(refresh)}
                      />
                    </div>
                  </Card>
                );
              })}
            <Card className="dashed">
              <QuickAdd
                label={`Ajouter un module en ${subject.name.toLowerCase()}`}
                button="Ajouter le module"
                placeholder="Par exemple : Espace et géométrie"
                onAdd={(title) => createModule(subject.id, title).then(refresh)}
              />
            </Card>
          </div>
        </Tabs>
      )}
    </div>
  );
}

type StateFilter = "active" | "archived" | "all";

/**
 * Référentiel de compétences (maquette Tuteur-Competences) : chercher, filtrer, ajouter, renommer,
 * réordonner, archiver. Le code ne change jamais ; une compétence n'est jamais supprimée.
 */
export function ReferentialPage() {
  const queryClient = useQueryClient();
  const referential = useQuery({ queryKey: ["referential"], queryFn: fetchReferential });
  const [error, setError] = useState<unknown>(null);
  const [search, setSearch] = useState("");
  const [domainId, setDomainId] = useState("");
  const [state, setState] = useState<StateFilter>("active");
  const [editing, setEditing] = useState<{ id: string; label: string } | null>(null);
  const [archiving, setArchiving] = useState<string | null>(null);
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["referential"] });
  const act = (work: () => Promise<unknown>) => {
    setError(null);
    void work()
      .then(async () => {
        setEditing(null);
        setArchiving(null);
        await refresh();
      })
      .catch((caught: unknown) => {
        setError(caught);
      });
  };

  if (referential.isPending) return <p role="status">Chargement…</p>;
  if (referential.isError) return <ErrorMessage error={referential.error} />;
  const { subjects, domains, competencies } = referential.data;
  const needle = search.trim().toLowerCase();
  const visible = (competency: (typeof competencies)[number]) =>
    (state === "all" || (state === "active") === (competency.archivedAt === null)) &&
    (needle === "" ||
      competency.code.toLowerCase().includes(needle) ||
      competency.label.toLowerCase().includes(needle));

  return (
    <div className="page">
      <PageHeader
        title="Référentiel de compétences"
        lead="Une compétence archivée n'est plus proposée pour les nouvelles épreuves ; l'historique des élèves reste lisible."
      />
      <div className="filters">
        <Field label="Chercher">
          {(control) => (
            <input
              {...control}
              type="search"
              placeholder="Code ou intitulé"
              value={search}
              onChange={(event) => {
                setSearch(event.target.value);
              }}
            />
          )}
        </Field>
        <Field label="Domaine">
          {(control) => (
            <select
              {...control}
              value={domainId}
              onChange={(event) => {
                setDomainId(event.target.value);
              }}
            >
              <option value="">Tous les domaines</option>
              {domains.map((domain) => (
                <option key={domain.id} value={domain.id}>
                  {domain.label}
                </option>
              ))}
            </select>
          )}
        </Field>
        <Field label="État">
          {(control) => (
            <select
              {...control}
              value={state}
              onChange={(event) => {
                const value = event.target.value;
                setState(value === "archived" ? "archived" : value === "all" ? "all" : "active");
              }}
            >
              <option value="active">Actives</option>
              <option value="archived">Archivées</option>
              <option value="all">Toutes</option>
            </select>
          )}
        </Field>
      </div>
      <ErrorMessage error={error} />
      <div className="stack">
        {subjects.map((subject) =>
          domains
            .filter(
              (domain) => domain.subjectId === subject.id && (domainId === "" || domain.id === domainId),
            )
            .sort((a, b) => a.position - b.position)
            .map((domain) => {
              const all = competencies
                .filter((competency) => competency.domainId === domain.id)
                .sort((a, b) => a.position - b.position);
              const items = all.filter(visible);
              const firstActive = all.find((competency) => competency.archivedAt === null)?.id;
              return (
                <Card key={domain.id} aria-labelledby={`domaine-${domain.id}`}>
                  <h2 id={`domaine-${domain.id}`}>
                    {domain.label} · {plural(all.length, "compétence")}{" "}
                    <span className="hint">({subject.name})</span>
                  </h2>
                  {items.length === 0 ? (
                    <p className="hint">Aucune compétence ne correspond.</p>
                  ) : (
                    <TableBox label={`Compétences : ${domain.label}`}>
                      <thead>
                        <tr>
                          <th scope="col">Code</th>
                          <th scope="col">Intitulé</th>
                          <th scope="col">Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {items.map((competency) => (
                          <tr
                            key={competency.id}
                            className={competency.archivedAt === null ? "" : "archived"}
                          >
                            <td>
                              <code>{competency.code}</code>
                            </td>
                            <td>
                              {editing?.id === competency.id ? (
                                <form
                                  className="inline"
                                  onSubmit={(event) => {
                                    event.preventDefault();
                                    if (editing.label.trim() !== "")
                                      act(() => updateCompetency(competency.id, { label: editing.label }));
                                  }}
                                >
                                  <Field label={`Nouvel intitulé de ${competency.code}`} className="grow">
                                    {(control) => (
                                      <input
                                        {...control}
                                        value={editing.label}
                                        onChange={(event) => {
                                          setEditing({ id: competency.id, label: event.target.value });
                                        }}
                                        required
                                      />
                                    )}
                                  </Field>
                                  <Button type="submit">Enregistrer</Button>
                                  <Button
                                    variant="quiet"
                                    onClick={() => {
                                      setEditing(null);
                                    }}
                                  >
                                    Annuler
                                  </Button>
                                </form>
                              ) : (
                                competency.label
                              )}
                            </td>
                            <td>
                              {competency.archivedAt !== null ? (
                                <Pill tone="closed" icon={Archive}>
                                  Archivée
                                </Pill>
                              ) : archiving === competency.id ? (
                                <div className="actions">
                                  <Button
                                    variant="danger"
                                    onClick={() => {
                                      act(() => archiveCompetency(competency.id));
                                    }}
                                  >
                                    Archiver {competency.code}
                                  </Button>
                                  <Button
                                    variant="quiet"
                                    icon={X}
                                    onClick={() => {
                                      setArchiving(null);
                                    }}
                                  >
                                    Annuler
                                  </Button>
                                </div>
                              ) : (
                                <div className="icon-actions">
                                  <Button
                                    variant="secondary"
                                    icon={ArrowUp}
                                    aria-label={`Monter ${competency.code}`}
                                    disabled={competency.id === firstActive}
                                    onClick={() => {
                                      act(() =>
                                        updateCompetency(competency.id, {
                                          position: Math.max(0, competency.position - 1),
                                        }),
                                      );
                                    }}
                                  />
                                  <Button
                                    variant="secondary"
                                    icon={Pencil}
                                    aria-label={`Renommer ${competency.code}`}
                                    onClick={() => {
                                      setEditing({ id: competency.id, label: competency.label });
                                    }}
                                  />
                                  <Button
                                    variant="secondary"
                                    icon={Archive}
                                    aria-label={`Archiver ${competency.code}`}
                                    onClick={() => {
                                      setArchiving(competency.id);
                                    }}
                                  />
                                </div>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </TableBox>
                  )}
                  <div className="section-gap">
                    <QuickAdd
                      label={`Nouvelle compétence (code ${domain.prefix}-… attribué automatiquement)`}
                      button="Ajouter"
                      placeholder="Intitulé de la compétence"
                      onAdd={(label) => addCompetency(domain.id, label).then(refresh)}
                    />
                  </div>
                </Card>
              );
            }),
        )}
      </div>
    </div>
  );
}
