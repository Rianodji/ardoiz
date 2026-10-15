import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useParams } from "react-router";
import { completeLesson, fetchLearnerProgramme, fetchLesson } from "../api/curriculum";
import { useMe } from "../auth/session";
import { ErrorMessage } from "../components/ErrorMessage";
import { LessonContentView, lessonOutline } from "../lesson/LessonContentView";
import { Button, Card, Notice } from "../ui";
import { longDate } from "../ui/format";
import { Check } from "../ui/icons";

/**
 * Un cours (maquette Eleve-Cours), pour l'élève (s'il est déverrouillé pour lui), son parent ou le
 * tuteur (R3) : un sommaire à gauche, une colonne de lecture, et « J'ai fini ce cours » en bas.
 */
export function LessonPage() {
  const { lessonId = "" } = useParams();
  const me = useMe();
  const learner = me.data?.kind === "learner";
  const queryClient = useQueryClient();
  const lesson = useQuery({ queryKey: ["lesson", lessonId], queryFn: () => fetchLesson(lessonId) });
  // Pour l'élève : la matière, le module, et si le cours est déjà terminé (même requête que « Mes cours »).
  const programme = useQuery({
    queryKey: ["learner-programme", me.data?.id ?? ""],
    queryFn: () => fetchLearnerProgramme(me.data?.id ?? ""),
    enabled: learner,
  });
  const complete = useMutation({
    mutationFn: () => completeLesson(lessonId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["learner-programme"] }),
  });

  if (lesson.isPending) return <p role="status">Chargement du cours…</p>;
  if (lesson.isError) {
    return (
      <div className="page narrow">
        <Card>
          <h1>Cours introuvable</h1>
          <p>
            {learner
              ? "Ce cours n'existe pas, ou il n'est pas encore ouvert pour toi. Demande à ton tuteur."
              : "Ce cours n'existe pas, ou vous n'y avez pas accès."}
          </p>
          <p>
            <Link to="/">Revenir à l'accueil</Link>
          </p>
        </Card>
      </div>
    );
  }
  const place = programme.data?.subjects
    .flatMap((subject) =>
      subject.modules.flatMap((module) =>
        module.lessons.map((entry) => ({ subject: subject.name, module: module.title, lesson: entry })),
      ),
    )
    .find((entry) => entry.lesson.id === lessonId);
  const outline = lessonOutline(lesson.data.content);
  const back = learner ? "/eleve/cours" : me.data?.kind === "guardian" ? "/famille" : "/tuteur/programme";

  return (
    <div className="page">
      <div className="grid-side-main">
        <nav aria-label="Sommaire du cours" className="toc">
          <p>
            <Link to={back}>{learner ? "Retour à mes cours" : "Retour"}</Link>
          </p>
          {outline.length > 0 && (
            <>
              <p className="caps">Dans ce cours</p>
              <ol>
                {outline.map((entry) => (
                  <li key={entry.id}>
                    <a href={`#${entry.id}`}>{entry.text}</a>
                  </li>
                ))}
              </ol>
            </>
          )}
        </nav>
        <Card as="article" className="reading">
          {place !== undefined && (
            <p className="kicker">
              {place.subject} · {place.module}
            </p>
          )}
          <h1>{lesson.data.title}</h1>
          <LessonContentView content={lesson.data.content} />
          {learner && (
            <div className="lesson-done">
              {complete.isSuccess ? (
                <Notice tone="success" icon={Check}>
                  <p role="status">Bravo, tu as fini ce cours !</p>
                </Notice>
              ) : place?.lesson.completedAt !== null && place?.lesson.completedAt !== undefined ? (
                <Notice tone="success" icon={Check}>
                  <p>Tu as fini ce cours le {longDate(place.lesson.completedAt)}.</p>
                </Notice>
              ) : (
                <>
                  <Button
                    icon={Check}
                    disabled={complete.isPending}
                    onClick={() => {
                      complete.mutate();
                    }}
                  >
                    J'ai fini ce cours
                  </Button>
                  <span className="hint">Tu gagnes des points quand tu as fini.</span>
                </>
              )}
              <ErrorMessage error={complete.error} />
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
