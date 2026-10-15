import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useId, useState } from "react";
import { useSearchParams } from "react-router";
import { fetchFamilies } from "../api/identity";
import { adjustLevel, fetchOverview, fetchProgress, type AdjustableLevel } from "../api/progress";
import { ErrorMessage } from "../components/ErrorMessage";
import { CompetencyList, LEVEL_LABELS, ProgressSummary } from "../components/ProgressViews";
import { Button, Card, PageHeader, TableBox } from "../ui";
import { plural } from "../ui/format";

const ADJUSTABLE: readonly AdjustableLevel[] = ["not_acquired", "in_progress", "acquired", "exceeded"];
const gradeFr = (grade: number | null) =>
  grade === null ? "—" : grade.toLocaleString("fr-FR", { maximumFractionDigits: 2 });

/** Barre en deux parts (acquises, en cours), en SVG : des attributs, aucun style en ligne (charte §9). */
function SkillSplit({
  acquired,
  inProgress,
  total,
}: {
  readonly acquired: number;
  readonly inProgress: number;
  readonly total: number;
}) {
  const width = (count: number) => (total === 0 ? 0 : (count / total) * 100);
  return (
    <span className="skill-split">
      <svg viewBox="0 0 100 8" preserveAspectRatio="none" aria-hidden="true" className="split-bar">
        <rect x="0" y="0" width="100" height="8" rx="4" className="split-rest" />
        <rect
          x="0"
          y="0"
          width={width(acquired) + width(inProgress)}
          height="8"
          rx="4"
          className="split-progress"
        />
        <rect x="0" y="0" width={width(acquired)} height="8" rx="4" className="split-acquired" />
      </svg>
      <span className="row-meta">
        {plural(acquired, "acquise")}
        {inProgress > 0 ? ` · ${String(inProgress)} en cours` : ""}
      </span>
    </span>
  );
}

/**
 * Synthèse du tuteur (L6, maquette Tuteur-Progression), par élève et par groupe. Elle n'existe que
 * dans l'espace tuteur : aucune donnée agrégée de plusieurs élèves n'est servie à un parent ou à un
 * élève (R17).
 */
export function TutorProgressPage() {
  const overview = useQuery({ queryKey: ["progress-overview"], queryFn: fetchOverview });
  const families = useQuery({ queryKey: ["families"], queryFn: fetchFamilies });
  const [params, setParams] = useSearchParams();
  const selected = params.get("eleve");
  const nameOf = (id: string) =>
    families.data?.learners.find((learner) => learner.id === id)?.firstName ?? "Élève";
  return (
    <div className="page">
      <PageHeader
        title="Progression des élèves"
        lead="Vue réservée au tuteur. Les élèves et les parents ne voient jamais de comparaison."
      />
      <div className="stack">
        {overview.isPending && <p role="status">Chargement…</p>}
        <ErrorMessage error={overview.error} />
        {overview.data !== undefined && (
          <Card>
            <TableBox label="Progression par élève">
              <thead>
                <tr>
                  <th scope="col">Élève</th>
                  <th scope="col">Niveau</th>
                  <th scope="col">Série</th>
                  <th scope="col">Compétences</th>
                  <th scope="col">Moyennes</th>
                  <th scope="col">
                    <span className="visually-hidden">Détail</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {overview.data.learners.map((entry) => {
                  const counts = entry.levelCounts;
                  const total = Object.values(counts).reduce((sum, count) => sum + count, 0);
                  return (
                    <tr key={entry.learnerId}>
                      <th scope="row">{nameOf(entry.learnerId)}</th>
                      <td className="num">
                        {entry.level} · {entry.xp} pts
                      </td>
                      <td className="num">
                        {entry.streak.paused ? "en pause" : plural(entry.streak.current, "semaine")}
                      </td>
                      <td>
                        <SkillSplit
                          acquired={counts.acquired + counts.exceeded}
                          inProgress={counts.in_progress + counts.not_acquired}
                          total={total}
                        />
                      </td>
                      <td>
                        {entry.averages
                          .filter((average) => average.average !== null)
                          .map((average) => `${average.name} : ${gradeFr(average.average)}`)
                          .join(" · ") || "—"}
                      </td>
                      <td>
                        <Button
                          variant="secondary"
                          aria-label={`Voir et ajuster : ${nameOf(entry.learnerId)}`}
                          aria-expanded={selected === entry.learnerId}
                          onClick={() => {
                            setParams({ eleve: entry.learnerId }, { replace: true });
                          }}
                        >
                          Voir et ajuster
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </TableBox>
          </Card>
        )}
        {overview.data !== undefined && overview.data.groups.length > 0 && (
          <Card aria-labelledby="par-groupe">
            <h2 id="par-groupe">Par groupe</h2>
            <p className="hint">
              Pour préparer la séance : où en est chaque groupe, toutes compétences confondues.
            </p>
            <ul className="rows">
              {overview.data.groups.map((group) => (
                <li key={group.groupId}>
                  <div className="row-main">
                    <p className="row-title">
                      Groupe {group.name} · {plural(group.learnerIds.length, "élève")}
                    </p>
                    <p className="row-meta">{group.learnerIds.map(nameOf).join(", ")}</p>
                  </div>
                  <p>
                    {plural(group.levelCounts.acquired + group.levelCounts.exceeded, "acquise")},{" "}
                    <strong>{group.levelCounts.in_progress} en cours</strong>,{" "}
                    {group.levelCounts.not_acquired} non acquises
                  </p>
                </li>
              ))}
            </ul>
          </Card>
        )}
        {selected !== null && <LearnerDetail key={selected} learnerId={selected} name={nameOf(selected)} />}
      </div>
    </div>
  );
}

function LearnerDetail({ learnerId, name }: { readonly learnerId: string; readonly name: string }) {
  const progress = useQuery({ queryKey: ["progress", learnerId], queryFn: () => fetchProgress(learnerId) });
  return (
    <Card aria-labelledby="detail-eleve">
      <h2 id="detail-eleve">{name}</h2>
      <ErrorMessage error={progress.error} />
      {progress.data !== undefined && (
        <div className="grid-two">
          <div className="stack-sm">
            <ProgressSummary progress={progress.data} />
            <h3>Compétences</h3>
            <CompetencyList progress={progress.data} />
          </div>
          <AdjustForm learnerId={learnerId} competencies={progress.data.competencies} />
        </div>
      )}
    </Card>
  );
}

/** Ajuster un niveau : justification obligatoire, auditée ; le calcul reprend à la preuve suivante. */
function AdjustForm({
  learnerId,
  competencies,
}: {
  readonly learnerId: string;
  readonly competencies: ReadonlyArray<{ competencyId: string; code: string; label: string }>;
}) {
  const queryClient = useQueryClient();
  const [competencyId, setCompetencyId] = useState(competencies[0]?.competencyId ?? "");
  const [level, setLevel] = useState<AdjustableLevel>("in_progress");
  const [justification, setJustification] = useState("");
  const ids = { competency: useId(), level: useId(), justification: useId(), visibility: useId() };
  const adjust = useMutation({
    mutationFn: () => adjustLevel(learnerId, competencyId, level, justification),
    onSuccess: async () => {
      setJustification("");
      await queryClient.invalidateQueries({ queryKey: ["progress", learnerId] });
      await queryClient.invalidateQueries({ queryKey: ["progress-overview"] });
    },
  });
  return (
    <form
      className="form-stack card dashed"
      onSubmit={(event) => {
        event.preventDefault();
        adjust.mutate();
      }}
    >
      <h3>Ajuster un niveau</h3>
      <p className="hint">Le niveau ajusté s'applique jusqu'à la prochaine preuve, puis le calcul reprend.</p>
      <label htmlFor={ids.competency}>Compétence</label>
      <select
        id={ids.competency}
        value={competencyId}
        onChange={(event) => {
          setCompetencyId(event.target.value);
        }}
      >
        {competencies.map((competency) => (
          <option key={competency.competencyId} value={competency.competencyId}>
            {competency.code} — {competency.label}
          </option>
        ))}
      </select>
      <label htmlFor={ids.level}>Niveau</label>
      <select
        id={ids.level}
        value={level}
        onChange={(event) => {
          const chosen = ADJUSTABLE.find((candidate) => candidate === event.target.value);
          if (chosen !== undefined) setLevel(chosen);
        }}
      >
        {ADJUSTABLE.map((value) => (
          <option key={value} value={value}>
            {LEVEL_LABELS[value]}
          </option>
        ))}
      </select>
      <label htmlFor={ids.justification}>Justification (5 à 500 caractères)</label>
      {/* La justification est servie à l'élève et à ses parents (transparence, big picture §8, verdict L6 S-4). */}
      <p className="hint" id={ids.visibility}>
        Visible par l'élève et ses parents.
      </p>
      <textarea
        id={ids.justification}
        aria-describedby={ids.visibility}
        value={justification}
        maxLength={500}
        rows={2}
        required
        onChange={(event) => {
          setJustification(event.target.value);
        }}
      />
      <div>
        <button type="submit" className="btn btn-primary" disabled={adjust.isPending}>
          Enregistrer l'ajustement
        </button>
      </div>
      {adjust.isSuccess && (
        <p role="status" className="status-line">
          Niveau ajusté.
        </p>
      )}
      <ErrorMessage error={adjust.error} />
    </form>
  );
}
