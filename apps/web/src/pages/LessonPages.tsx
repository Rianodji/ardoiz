import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useParams } from "react-router";
import { completeLesson, fetchLearnerProgramme, fetchLesson } from "../api/curriculum";
import { useMe } from "../auth/session";
import { ErrorMessage } from "../components/ErrorMessage";
import { LessonContentView } from "../lesson/LessonContentView";

const dateFr = new Intl.DateTimeFormat("fr-FR", { dateStyle: "long", timeZone: "Europe/Paris" });

/** Un cours, pour l'élève (s'il est déverrouillé pour lui), son parent ou le tuteur (R3). */
export function LessonPage() {
  const { lessonId = "" } = useParams();
  const me = useMe();
  const queryClient = useQueryClient();
  const lesson = useQuery({ queryKey: ["lesson", lessonId], queryFn: () => fetchLesson(lessonId) });
  const complete = useMutation({
    mutationFn: () => completeLesson(lessonId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["learner-programme"] }),
  });

  if (lesson.isPending) return <p role="status">Chargement du cours…</p>;
  if (lesson.isError) {
    return (
      <section className="card">
        <h1>Cours introuvable</h1>
        <p>Ce cours n'existe pas, ou il n'est pas encore ouvert pour toi. Demande à ton tuteur.</p>
        <p>
          <Link to="/">Revenir à l'accueil</Link>
        </p>
      </section>
    );
  }
  return (
    <article className="card wide lesson">
      <h1>{lesson.data.title}</h1>
      <LessonContentView content={lesson.data.content} />
      {me.data?.kind === "learner" && (
        <div className="lesson-actions">
          {complete.isSuccess ? (
            <p role="status" className="notice">
              Bravo, tu as terminé ce cours !
            </p>
          ) : (
            <button
              type="button"
              className="button"
              disabled={complete.isPending}
              onClick={() => {
                complete.mutate();
              }}
            >
              J'ai terminé ce cours
            </button>
          )}
          <ErrorMessage error={complete.error} />
        </div>
      )}
    </article>
  );
}

/** Ce qu'un élève a débloqué, matière par matière, et ce qu'il a terminé. */
export function LearnerProgrammeView({
  learnerId,
  emptyText,
}: {
  readonly learnerId: string;
  readonly emptyText: string;
}) {
  const programme = useQuery({
    queryKey: ["learner-programme", learnerId],
    queryFn: () => fetchLearnerProgramme(learnerId),
  });
  if (programme.isPending) return <p role="status">Chargement…</p>;
  if (programme.isError) return <ErrorMessage error={programme.error} />;
  if (programme.data.subjects.length === 0) return <p>{emptyText}</p>;
  return (
    <div className="programme">
      {programme.data.subjects.map((subject) => (
        <section key={subject.id} className="subject">
          <h3>{subject.name}</h3>
          {subject.modules.map((module) => (
            <div key={module.id} className="module">
              <h4>{module.title}</h4>
              <ul className="lesson-list">
                {module.lessons.map((lesson) => (
                  <li key={lesson.id}>
                    <Link to={`/cours/${lesson.id}`}>{lesson.title}</Link>
                    {lesson.completedAt === null ? (
                      <span className="badge todo">à lire</span>
                    ) : (
                      <span className="badge done">
                        terminé le {dateFr.format(new Date(lesson.completedAt))}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </section>
      ))}
    </div>
  );
}
