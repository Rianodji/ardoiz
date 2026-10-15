import { e2eState, expect, loginLearner, loginTutor, test } from "../fixtures.js";

/** Pages riches sous la CSP de production (dette du lot L2) : aucune violation tolérée (R11). */
test("la page d'un cours (formule MathML, encadré, vidéo après clic) respecte la CSP", async ({ page }) => {
  const state = e2eState();
  await loginLearner(page, state);
  await page.goto(`/cours/${state.lessonId}`);
  await expect(page.getByRole("heading", { name: "Convertir des longueurs", level: 1 })).toBeVisible();
  await expect(page.locator("math")).toHaveCount(1);
  await page.getByRole("button", { name: /Voir la vidéo/ }).click();
  await expect(page.locator("iframe")).toHaveAttribute("src", /youtube-nocookie\.com/);
});

test("l'éditeur de cours du tuteur respecte la CSP", async ({ page }) => {
  const state = e2eState();
  await loginTutor(page, state);
  await page.goto(`/tuteur/cours/${state.lessonId}`);
  await expect(page.getByRole("toolbar", { name: "Mise en forme du cours" })).toBeVisible();
  await page.getByRole("button", { name: "Aperçu" }).click();
  await expect(page.getByRole("region", { name: /Aperçu/ })).toBeVisible();
});

test("les en-têtes de production sont posés sur la SPA", async ({ page }) => {
  const response = await page.goto("/");
  const csp = response?.headers()["content-security-policy"] ?? "";
  expect(csp).toContain("default-src 'self'");
  expect(csp).toContain("script-src 'self'");
  expect(csp).not.toContain("unsafe-inline");
});
