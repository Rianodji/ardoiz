import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useId, useState } from "react";
import { fetchFamilies } from "../api/identity";
import { adjustLevel, fetchOverview, fetchProgress, type AdjustableLevel } from "../api/progress";
import { ErrorMessage } from "../components/ErrorMessage";
import { CompetencyList, LEVEL_LABELS, ProgressSummary } from "../components/ProgressViews";

const ADJUSTABLE: readonly AdjustableLevel[] = ["not_acquired", "in_progress", "acquired", "exceeded"];
const gradeFr = (grade: number | null) =>
  grade === null ? "—" : grade.toLocaleString("fr-FR", { maximumFractionDigits: 2 });

/**
 * Synthèse du tuteur (L6), par élève et par groupe. Elle n'existe que dans l'espace tuteur : aucune
 * donnée agrégée de plusieurs élèves n'est servie à un parent ou à un élève (R17).
 */
export function TutorProgressPage() {
  const overview = useQuery({ queryKey: ["progress-overview"], queryFn: fetchOverview });
  const families = useQuery({ queryKey: ["families"], queryFn: fetchFamilies });
  const [selected, setSelected] = useState<string | null>(null);
  const nameOf = (id: string) =>
    families.data?.learners.find((learner) => learner.id === id)?.firstName ?? "Élève";
  return (
    <div className="stack">
      <section className="card">
        <h1>Progression des élèves</h1>
        {overview.isPending && <p role="status">Chargement…</p>}
        <ErrorMessage error={overview.error} />
        {overview.data !== undefined && (
          <table className="grades-table">
            <thead>
              <tr>
                <th scope="col">Élève</th>
                <th scope="col">Niveau</th>
                <th scope="col">Série</th>
                <th scope="col">Compétences acquises</th>
                <th scope="col">Moyennes</th>
                <th scope="col">
                  <span className="visually-hidden">Détail</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {overview.data.learners.map((entry) => (
                <tr key={entry.learnerId}>
                  <td>{nameOf(entry.learnerId)}</td>
                  <td>
                    {entry.level} ({entry.xp} pts)
                  </td>
                  <td>{entry.streak.current}</td>
                  <td>{entry.levelCounts.acquired + entry.levelCounts.exceeded}</td>
                  <td>
                    {entry.averages
                      .map((average) => `${average.name} : ${gradeFr(average.average)}`)
                      .join(" · ") || "—"}
                  </td>
                  <td>
                    <button
                      type="button"
                      className="link-button"
                      onClick={() => {
                        setSelected(entry.learnerId);
                      }}
                    >
                      Voir et ajuster
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
      {overview.data !== undefined && overview.data.groups.length > 0 && (
        <section className="card">
          <h2>Par groupe</h2>
          <ul>
            {overview.data.groups.map((group) => (
              <li key={group.groupId}>
                <strong>{group.name}</strong> ({group.learnerIds.length} élève
                {group.learnerIds.length > 1 ? "s" : ""}) :{" "}
                {group.levelCounts.acquired + group.levelCounts.exceeded} compétences acquises,{" "}
                {group.levelCounts.in_progress} en cours, {group.levelCounts.not_acquired} non acquises
              </li>
            ))}
          </ul>
        </section>
      )}
      {selected !== null && <LearnerDetail learnerId={selected} name={nameOf(selected)} />}
    </div>
  );
}

function LearnerDetail({ learnerId, name }: { readonly learnerId: string; readonly name: string }) {
  const progress = useQuery({ queryKey: ["progress", learnerId], queryFn: () => fetchProgress(learnerId) });
  return (
    <section className="card">
      <h2>{name}</h2>
      <ErrorMessage error={progress.error} />
      {progress.data !== undefined && (
        <>
          <ProgressSummary progress={progress.data} you={false} />
          <h3>Compétences</h3>
          <CompetencyList progress={progress.data} />
          <AdjustForm learnerId={learnerId} competencies={progress.data.competencies} />
        </>
      )}
    </section>
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
  const ids = { competency: useId(), level: useId(), justification: useId() };
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
      <textarea
        id={ids.justification}
        value={justification}
        maxLength={500}
        rows={2}
        required
        onChange={(event) => {
          setJustification(event.target.value);
        }}
      />
      <button type="submit" className="button" disabled={adjust.isPending}>
        Enregistrer l'ajustement
      </button>
      {adjust.isSuccess && <p role="status">Niveau ajusté.</p>}
      <ErrorMessage error={adjust.error} />
    </form>
  );
}
