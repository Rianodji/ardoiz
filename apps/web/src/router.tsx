import { createBrowserRouter, type RouteObject } from "react-router";
import { RequireRole } from "./auth/session";
import { AppLayout } from "./layout/AppLayout";
import { AccountPage, HomePage, LearnerHomePage, LegalPage } from "./pages/AccountPages";
import { FamilyPage } from "./pages/FamilyPage";
import { InvitationPage } from "./pages/InvitationPage";
import { LoginPage } from "./pages/LoginPage";
import { NotFoundPage } from "./pages/NotFoundPage";
import { ForgotPasswordPage, NewPasswordPage } from "./pages/PasswordPages";
import { TotpEnrollPage, TotpVerifyPage } from "./pages/TotpPages";
import { AuditPage, TutorFamiliesPage } from "./pages/TutorPages";

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
      { path: "*", element: <NotFoundPage /> },
    ],
  },
];

export const router = createBrowserRouter(routes);
