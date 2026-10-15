import { e2eState, expect, loginGuardian, loginLearner, loginTutor, test } from "../fixtures.js";

/** Tableaux de bord et suggestions sous la CSP de production (L6, R4, R17). */
test("l'élève voit sa progression : ses points arrivent par le relais (CoursTerminé, CopieRendue)", async ({
  page,
}) => {
  const state = e2eState();
  await loginLearner(page, state);
  await expect(page.getByRole("heading", { name: "Mes progrès" })).toBeVisible();
  await expect(page.getByText(/points · niveau \d+/)).toBeVisible();
  await page.goto("/eleve/progres");
  await expect(page.getByText(/^Niveau \d+$/)).toBeVisible();
  await expect(page.locator(".xp-number")).toHaveText(/^[1-9][0-9]*$/);
  await expect(page.getByRole("heading", { name: "Ma série : 1 semaine" })).toBeVisible();
});

test("le parent voit le tableau de bord de son enfant et envoie une suggestion, affichée comme du texte", async ({
  page,
}) => {
  const state = e2eState();
  await loginGuardian(page, state);
  await page.goto("/famille");
  await expect(page.getByRole("heading", { name: "Suivi de Lina" })).toBeVisible();
  await expect(page.getByText(/· [1-9][0-9]* points/)).toBeVisible();
  await expect(page.getByRole("heading", { name: "Ses devoirs" })).toBeVisible();
  await expect(page.getByText(/à rendre le /).first()).toBeVisible();
  await page.getByRole("link", { name: "Suggestions" }).click();
  const text = '<img src=x onerror="alert(1)"> Merci pour le cours !';
  await page.getByLabel("Votre message").fill(text);
  await page.getByRole("button", { name: "Envoyer au tuteur" }).click();
  await expect(page.getByText(text)).toBeVisible();
  await expect(page.locator("main img")).toHaveCount(0);
});

test("le tuteur voit la synthèse et la boîte des suggestions", async ({ page }) => {
  const state = e2eState();
  await loginTutor(page, state);
  await page.goto("/tuteur/progression");
  await expect(page.getByRole("heading", { name: "Progression des élèves" })).toBeVisible();
  await expect(page.getByRole("rowheader", { name: "Lina" })).toBeVisible();
  await page
    .getByRole("button", { name: /Voir et ajuster/ })
    .first()
    .click();
  await expect(page.getByRole("heading", { name: "Ajuster un niveau" })).toBeVisible();
  await page.goto("/tuteur/suggestions");
  await expect(page.getByRole("heading", { name: "Suggestions des parents" })).toBeVisible();
});
