import { lazy, Suspense, type ComponentType } from "react";
import { createBrowserRouter, Navigate, type RouteObject } from "react-router";
import { RequireRole } from "./auth/session";
import { AppLayout } from "./layout/AppLayout";
import { AccountPage, HomePage, LegalPage } from "./pages/AccountPages";
import { LearnerAgendaPage } from "./pages/AgendaPages";
import {
  LearnerAssignmentsPage,
  LearnerHomePage,
  LearnerLessonsPage,
  LearnerProgressPage,
} from "./pages/LearnerPages";
import { AttemptPage } from "./pages/AssessmentPages";
import { FamilyPage } from "./pages/FamilyPage";
import { InvitationPage } from "./pages/InvitationPage";
import { LessonPage } from "./pages/LessonPages";
import { LoginPage } from "./pages/LoginPage";
import { NotFoundPage } from "./pages/NotFoundPage";
import { ForgotPasswordPage, NewPasswordPage } from "./pages/PasswordPages";
import { TotpEnrollPage, TotpVerifyPage } from "./pages/TotpPages";
import { GuardianSuggestionsPage, SuggestionsInboxPage } from "./pages/SuggestionPages";

/** Une page chargée à la demande, depuis l'export nommé de son module. */
function lazyPage<K extends string>(load: () => Promise<Record<K, ComponentType>>, name: K) {
  return lazy(() => load().then((module) => ({ default: module[name] })));
}

/**
 * L'espace du tuteur (et son éditeur TipTap) n'est chargé que par le tuteur, à la demande : le paquet
 * principal, celui de l'élève et du parent, reste léger (L8 : budget de 30 ko compressés).
 */
const tutorPages = () => import("./pages/TutorPages");
const programmePages = () => import("./pages/TutorProgrammePages");
const assessmentPages = () => import("./pages/TutorAssessmentPages");
const TutorTodayPage = lazyPage(tutorPages, "TutorTodayPage");
const TutorFamiliesPage = lazyPage(tutorPages, "TutorFamiliesPage");
const AuditPage = lazyPage(tutorPages, "AuditPage");
const TutorProgrammePage = lazyPage(programmePages, "TutorProgrammePage");
const ReferentialPage = lazyPage(programmePages, "ReferentialPage");
const TutorAssessmentsPage = lazyPage(assessmentPages, "TutorAssessmentsPage");
const GradingQueuePage = lazyPage(assessmentPages, "GradingQueuePage");
const GradingAttemptPage = lazyPage(assessmentPages, "GradingAttemptPage");
const TutorProgressPage = lazyPage(() => import("./pages/TutorProgressPage"), "TutorProgressPage");
const TutorSessionsPage = lazyPage(() => import("./pages/TutorSessionsPage"), "TutorSessionsPage");
const LessonEditorPage = lazyPage(() => import("./pages/LessonEditorPage"), "LessonEditorPage");

export const routes: RouteObject[] = [
  {
    path: "/",
    element: <AppLayout />,
    children: [
      { index: true, element: <HomePage /> },
      { path: "connexion", element: <LoginPage /> },
      { path: "double-authentification", element: <TotpVerifyPage /> },
      {
        path: "double-authentification/activer",
        element: (
          <RequireRole roles={["tutor", "guardian"]}>
            <TotpEnrollPage />
          </RequireRole>
        ),
      },
      { path: "invitation", element: <InvitationPage /> },
      { path: "mot-de-passe-oublie", element: <ForgotPasswordPage /> },
      { path: "mot-de-passe/nouveau", element: <NewPasswordPage /> },
      { path: "mentions-legales", element: <LegalPage document="mentions-legales" /> },
      { path: "confidentialite", element: <LegalPage document="confidentialite" /> },
      {
        path: "mes-donnees",
        element: (
          <RequireRole roles={["learner"]}>
            <LegalPage document="confidentialite-eleve" />
          </RequireRole>
        ),
      },
      {
        path: "compte",
        element: (
          <RequireRole roles={["tutor", "guardian", "learner"]}>
            <AccountPage />
          </RequireRole>
        ),
      },
      {
        path: "famille",
        element: (
          <RequireRole roles={["guardian"]}>
            <FamilyPage />
          </RequireRole>
        ),
      },
      {
        path: "famille/suggestions",
        element: (
          <RequireRole roles={["guardian"]}>
            <GuardianSuggestionsPage />
          </RequireRole>
        ),
      },
      ...(
        [
          ["eleve", <LearnerHomePage key="accueil" />],
          ["eleve/cours", <LearnerLessonsPage key="cours" />],
          ["eleve/devoirs", <LearnerAssignmentsPage key="devoirs" />],
          ["eleve/progres", <LearnerProgressPage key="progres" />],
          ["eleve/seances", <LearnerAgendaPage key="seances" />],
        ] as const
      ).map(([path, page]) => ({ path, element: <RequireRole roles={["learner"]}>{page}</RequireRole> })),
      {
        path: "cours/:lessonId",
        element: (
          <RequireRole roles={["tutor", "guardian", "learner"]}>
            <LessonPage />
          </RequireRole>
        ),
      },
      {
        path: "copie/:attemptId",
        element: (
          <RequireRole roles={["tutor", "guardian", "learner"]}>
            <AttemptPage />
          </RequireRole>
        ),
      },
      ...(
        [
          ["tuteur", <TutorTodayPage key="aujourdhui" />],
          ["tuteur/eleves", <TutorFamiliesPage key="eleves" />],
          ["tuteur/journal", <AuditPage key="journal" />],
          // Anciennes adresses (v1.0) : les groupes sont rangés dans « Élèves et familles » (charte §6).
          ["tuteur/familles", <Navigate key="familles" to="/tuteur/eleves" replace />],
          ["tuteur/groupes", <Navigate key="groupes" to="/tuteur/eleves?onglet=groupes" replace />],
          ["tuteur/programme", <TutorProgrammePage key="programme" />],
          ["tuteur/epreuves", <TutorAssessmentsPage key="epreuves" />],
          ["tuteur/seances", <TutorSessionsPage key="seances" />],
          ["tuteur/corrections", <GradingQueuePage key="corrections" />],
          ["tuteur/corrections/:attemptId", <GradingAttemptPage key="correction" />],
          ["tuteur/referentiel", <ReferentialPage key="referentiel" />],
          ["tuteur/progression", <TutorProgressPage key="progression" />],
          ["tuteur/suggestions", <SuggestionsInboxPage key="suggestions" />],
          ["tuteur/cours/:lessonId", <LessonEditorPage key="editeur" />],
        ] as const
      ).map(([path, page]) => ({
        path,
        element: (
          <RequireRole roles={["tutor"]}>
            <Suspense fallback={<p role="status">Chargement…</p>}>{page}</Suspense>
          </RequireRole>
        ),
      })),
      { path: "*", element: <NotFoundPage /> },
    ],
  },
];

export const router = createBrowserRouter(routes);
