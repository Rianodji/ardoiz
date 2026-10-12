import { lazy, Suspense } from "react";
import { createBrowserRouter, type RouteObject } from "react-router";
import { RequireRole } from "./auth/session";
import { AppLayout } from "./layout/AppLayout";
import { AccountPage, HomePage, LearnerHomePage, LegalPage } from "./pages/AccountPages";
import { FamilyPage } from "./pages/FamilyPage";
import { InvitationPage } from "./pages/InvitationPage";
import { LessonPage } from "./pages/LessonPages";
import { LoginPage } from "./pages/LoginPage";
import { NotFoundPage } from "./pages/NotFoundPage";
import { ForgotPasswordPage, NewPasswordPage } from "./pages/PasswordPages";
import { TotpEnrollPage, TotpVerifyPage } from "./pages/TotpPages";
import { GroupsPage, ReferentialPage, TutorProgrammePage } from "./pages/TutorProgrammePages";
import { AuditPage, TutorFamiliesPage } from "./pages/TutorPages";

/** L'éditeur (TipTap) n'est chargé que par le tuteur, à la demande : la page des élèves reste légère. */
const LessonEditorPage = lazy(() =>
  import("./pages/LessonEditorPage").then((module) => ({ default: module.LessonEditorPage })),
);

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
        path: "eleve",
        element: (
          <RequireRole roles={["learner"]}>
            <LearnerHomePage />
          </RequireRole>
        ),
      },
      {
        path: "tuteur/familles",
        element: (
          <RequireRole roles={["tutor"]}>
            <TutorFamiliesPage />
          </RequireRole>
        ),
      },
      {
        path: "tuteur/journal",
        element: (
          <RequireRole roles={["tutor"]}>
            <AuditPage />
          </RequireRole>
        ),
      },
      {
        path: "cours/:lessonId",
        element: (
          <RequireRole roles={["tutor", "guardian", "learner"]}>
            <LessonPage />
          </RequireRole>
        ),
      },
      ...(
        [
          ["tuteur/programme", <TutorProgrammePage key="programme" />],
          ["tuteur/referentiel", <ReferentialPage key="referentiel" />],
          ["tuteur/groupes", <GroupsPage key="groupes" />],
          [
            "tuteur/cours/:lessonId",
            <Suspense key="editeur" fallback={<p role="status">Chargement de l'éditeur…</p>}>
              <LessonEditorPage />
            </Suspense>,
          ],
        ] as const
      ).map(([path, page]) => ({ path, element: <RequireRole roles={["tutor"]}>{page}</RequireRole> })),
      { path: "*", element: <NotFoundPage /> },
    ],
  },
];

export const router = createBrowserRouter(routes);
