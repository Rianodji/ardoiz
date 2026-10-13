import type { Page } from "@playwright/test";
import { randomBytes } from "node:crypto";
import { e2eState, expect, loginTutor, test } from "../fixtures.js";
import { invitationToken } from "../mail.js";

/**
 * Parcours complet du J1 (L7), sous la CSP de production, et en CI contre l'image de production :
 * invitation → consentement → compte de l'enfant → cours → devoir sur le cahier → correction →
 * tableau de bord du parent. Chaque geste d'un parent ou d'un élève passe par l'interface ; le tuteur
 * prépare et corrige par l'API (ses pages sont couvertes par les autres tests).
 */
test("de l'invitation du parent au tableau de bord, en passant par le cahier et la correction", async ({
  page,
  browser,
}) => {
  test.setTimeout(240_000);
  const state = e2eState();
  const parentEmail = "fatou.parcours@example.org";
  // Tiré au hasard à chaque exécution : aucun mot de passe écrit en dur (R20, gitleaks).
  const childPassword = `baleine-${randomBytes(4).toString("hex")}`;

  // 1. Le tuteur invite un parent, depuis sa page des familles.
  const tutorContext = await browser.newContext({ baseURL: state.baseURL });
  const tutor: Page = await tutorContext.newPage();
  await loginTutor(tutor, state);
  await tutor.goto("/tuteur/familles");
  await tutor.getByLabel("Inviter un parent (adresse e-mail)").fill(parentEmail);
  await tutor.getByRole("button", { name: "Envoyer l'invitation" }).click();
  await expect(tutor.getByRole("status")).toBeVisible();
  const api = async <T>(method: string, path: string, data?: unknown): Promise<T> => {
    const response = await tutor.request.fetch(path, {
      method,
      headers: { origin: state.baseURL },
      ...(data === undefined ? {} : { data }),
    });
    expect(response.ok(), `${method} ${path} : ${await response.text()}`).toBe(true);
    const text = await response.text();
    return (text === "" ? null : JSON.parse(text)) as T;
  };

  // 2. Le parent ouvre le lien reçu par e-mail, crée son compte et donne son consentement.
  const token = await invitationToken(state.mailpitUrl, parentEmail);
  await page.goto(`/invitation#jeton=${token}`);
  await page.getByLabel(/Ton nom/).fill("Fatou");
  await page.getByLabel(/Choisis un mot de passe/).fill(state.adultPassword);
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "Je donne mon accord" }).click();
  await expect(page.getByRole("heading", { name: "Mes enfants" })).toBeVisible();

  // 3. Il crée le compte de son enfant, avec un second consentement.
  const creation = page.locator("section").filter({ hasText: "Créer le compte d'un enfant" });
  await creation.getByLabel("Prénom").fill("Sami");
  await creation.getByLabel(/Pseudo de connexion/).fill("sami");
  await creation.getByLabel("Classe").selectOption("6e");
  await creation.getByLabel(/Son mot de passe/).fill(childPassword);
  await creation.getByRole("checkbox").check();
  await creation.getByRole("button", { name: "Je donne mon accord" }).click();
  await expect(page.getByRole("heading", { name: /Sami/ })).toBeVisible();
  const learners = await page.evaluate(
    async () =>
      (await (await fetch("/api/learners")).json()) as { learners: Array<{ id: string; firstName: string }> },
  );
  const samiId = learners.learners.find((learner) => learner.firstName === "Sami")?.id ?? "";
  expect(samiId).toMatch(/^lrn_/);

  // 4. Le tuteur ouvre le cours à Sami et lui donne un devoir sur le cahier.
  await api("POST", "/api/unlocks", {
    target: { kind: "lesson", id: state.lessonId },
    audience: { kind: "learner", id: samiId },
  });
  const referential = await api<{ subjects: Array<{ id: string; name: string }> }>("GET", "/api/referential");
  const subjectId = referential.subjects.find((subject) => subject.name === "Mathématiques")?.id ?? "";
  const { competencies } = await api<{ competencies: Array<{ id: string }> }>("GET", "/api/competencies");
  const { id: assessmentId } = await api<{ id: string }>("POST", "/api/assessments", {
    subjectId,
    title: "Parcours : tracer un carré",
  });
  await api("PUT", `/api/assessments/${assessmentId}/questions`, {
    questions: [
      { kind: "notebook", prompt: "Trace un carré.", points: 5, competencyIds: [competencies[0]?.id ?? ""] },
    ],
  });
  await api("POST", "/api/assignments", {
    assessmentId,
    audience: { kind: "learner", id: samiId },
    opensAt: new Date(Date.now() - 3_600_000).toISOString(),
    dueAt: new Date(Date.now() + 86_400_000).toISOString(),
    maxAttempts: 1,
    lateAllowed: false,
    publication: "manual",
  });

  // 5. Sami se connecte, termine le cours, fait son devoir sur le cahier et le rend.
  await page.context().clearCookies();
  await page.goto("/connexion");
  await page.getByLabel("Code de ton espace").fill(state.spaceCode);
  await page.getByLabel("Ton pseudo").fill("sami");
  await page.getByLabel("Mot de passe").fill(childPassword);
  await page.getByRole("button", { name: "Me connecter" }).click();
  await expect(page.getByRole("heading", { name: /Bonjour Sami/ })).toBeVisible();
  await page.goto(`/cours/${state.lessonId}`);
  await page.getByRole("button", { name: "J'ai terminé ce cours" }).click();
  await expect(page.getByText("Bravo, tu as terminé ce cours !")).toBeVisible();
  await page.goto("/eleve");
  await page
    .getByRole("listitem")
    .filter({ hasText: "Parcours : tracer un carré" })
    .getByRole("button", { name: "Commencer" })
    .click();
  const area = page.locator(".notebook-canvas");
  await expect(page.locator(".notebook-canvas canvas.interactive")).toBeVisible();
  await area.scrollIntoViewIfNeeded();
  const box = await area.boundingBox();
  if (box === null) throw new Error("Cahier absent.");
  await page.locator("label", { has: page.getByTestId("toolbar-rectangle") }).click();
  await page.mouse.move(box.x + box.width / 2 - 80, box.y + 160);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 20, box.y + 260, { steps: 8 });
  await page.mouse.up();
  await expect(page.getByText("Enregistré.")).toBeVisible({ timeout: 20_000 });
  const attemptId = page.url().split("/copie/")[1] ?? "";
  page.once("dialog", (dialog) => void dialog.accept());
  await page.getByRole("button", { name: "Rendre ma copie" }).click();
  await expect(page.getByText("Copie rendue.")).toBeVisible();

  // 6. Le tuteur corrige (4 points sur 5) et publie.
  const copy = await api<{ questions: Array<{ id: string }> }>("GET", `/api/grading/attempts/${attemptId}`);
  await api("POST", `/api/grading/attempts/${attemptId}/grades`, {
    grades: [{ questionId: copy.questions[0]?.id ?? "", earned: 4, comment: "Bien tracé." }],
  });
  await api("POST", `/api/grading/attempts/${attemptId}/publish`);
  await tutorContext.close();

  // 7. Le parent voit la note (16/20), la copie corrigée et le badge « Premier pas » de Sami.
  await page.context().clearCookies();
  const login = await page.request.post("/api/auth/login/adult", {
    headers: { origin: state.baseURL },
    data: { email: parentEmail, password: state.adultPassword },
  });
  expect(login.status()).toBe(200);
  await expect(async () => {
    await page.goto("/famille");
    const sami = page.locator("article").filter({ hasText: "Sami" });
    await expect(sami.getByRole("link", { name: "Parcours : tracer un carré" })).toBeVisible({
      timeout: 2_000,
    });
    await expect(sami.getByText(/moyenne : 16 \/ 20/)).toBeVisible({ timeout: 2_000 });
    await expect(sami.getByText(/Premier pas/)).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 30_000 });
  await page
    .locator("article")
    .filter({ hasText: "Sami" })
    .getByRole("link", { name: "Parcours : tracer un carré" })
    .click();
  await expect(page.getByText(/16/).first()).toBeVisible();
});
