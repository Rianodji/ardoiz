import { e2eState, expect, loginGuardian, loginLearner, loginTutor, test } from "../fixtures.js";

/** Tableaux de bord et suggestions sous la CSP de production (L6, R4, R17). */
test("l'élève voit sa progression : ses points arrivent par le relais (CoursTerminé, CopieRendue)", async ({
  page,
}) => {
  const state = e2eState();
  await loginLearner(page, state);
  await expect(page.getByRole("heading", { name: "Ma progression" })).toBeVisible();
  await expect(page.getByText(/Niveau 0/)).toBeVisible();
  await expect(page.getByText(/· [1-9][0-9]* points/)).toBeVisible();
  await expect(page.getByText(/1 semaine d'activité/)).toBeVisible();
});

test("le parent voit le tableau de bord de son enfant et envoie une suggestion, affichée comme du texte", async ({
  page,
}) => {
  const state = e2eState();
  await loginGuardian(page, state);
  await page.goto("/famille");
  await expect(page.getByText("Son tableau de bord")).toBeVisible();
  await expect(page.getByText(/· [1-9][0-9]* points/)).toBeVisible();
  await expect(page.getByRole("heading", { name: "Ses épreuves" })).toBeVisible();
  await expect(page.getByText(/ — à rendre le /).first()).toBeVisible();
  const text = '<img src=x onerror="alert(1)"> Merci pour le cours !';
  await page.getByLabel(/Ta suggestion/).fill(text);
  await page.getByRole("button", { name: "Envoyer" }).click();
  await expect(page.getByText(text)).toBeVisible();
  await expect(page.locator("main img")).toHaveCount(0);
});

test("le tuteur voit la synthèse et la boîte des suggestions", async ({ page }) => {
  const state = e2eState();
  await loginTutor(page, state);
  await page.goto("/tuteur/progression");
  await expect(page.getByRole("heading", { name: "Progression des élèves" })).toBeVisible();
  await expect(page.getByRole("cell", { name: "Lina" })).toBeVisible();
  await page.getByRole("button", { name: "Voir et ajuster" }).first().click();
  await expect(page.getByRole("heading", { name: "Ajuster un niveau" })).toBeVisible();
  await page.goto("/tuteur/suggestions");
  await expect(page.getByRole("heading", { name: "Suggestions des parents" })).toBeVisible();
});
