import { e2eState, expect, loginLearner, loginTutor, test } from "../fixtures.js";

/** Agenda et lien de visio sous la CSP de production (R9, R11). */
test("l'élève voit sa séance dans l'agenda, sans lien, et l'obtient en cliquant « Rejoindre »", async ({
  page,
}) => {
  const state = e2eState();
  await loginLearner(page, state);
  const row = page.getByRole("listitem").filter({ hasText: "Séance de géométrie" });
  await expect(row).toBeVisible();
  // Aucun lien de visio dans la page avant le clic (R9).
  expect(await page.content()).not.toContain("meet.jit.si");
  await row.getByRole("button", { name: "Rejoindre" }).click();
  const link = row.getByRole("link", { name: "Ouvrir la salle de visio" });
  await expect(link).toHaveAttribute("href", /^https:\/\/meet\.jit\.si\/ardoiz-[A-Za-z0-9_-]{24}$/);
  await expect(link).toHaveAttribute("rel", "noopener noreferrer");
});

test("la page des séances du tuteur respecte la CSP", async ({ page }) => {
  const state = e2eState();
  await loginTutor(page, state);
  await page.goto("/tuteur/seances");
  await expect(page.getByRole("heading", { name: "Séance de géométrie" })).toBeVisible();
  await expect(page.getByText(/https:\/\/meet\.jit\.si\/ardoiz-/)).toBeVisible();
});
