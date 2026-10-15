import { e2eState, expect, loginTutor, test } from "../fixtures.js";

/**
 * L8, correction 1 : après « Me déconnecter », la page de connexion affichait encore le menu du
 * tuteur. Désormais aucun lien du tuteur n'est visible, et une page protégée renvoie vers la connexion.
 */
test("après la déconnexion, plus rien du tuteur, et une page protégée renvoie vers la connexion", async ({
  page,
}) => {
  const state = e2eState();
  await loginTutor(page, state);
  await page.goto("/");
  await expect(page.getByRole("link", { name: /Journal d'audit/ })).toBeVisible();
  await page.getByRole("button", { name: "Me déconnecter" }).click();
  await expect(page).toHaveURL(/\/connexion$/);
  await expect(page.getByRole("heading", { name: "Se connecter" })).toBeVisible();
  for (const name of [/Programme/, /Corrections/, /Journal d'audit/, /Mon compte/])
    await expect(page.getByRole("link", { name })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Me déconnecter" })).toHaveCount(0);

  // L'accueil, puis une page du tuteur en accès direct : la connexion, à chaque fois. (La déconnexion
  // remplace l'entrée de l'historique : « Précédent » ne ramène pas sur une page du tuteur.)
  await page.goto("/");
  await expect(page).toHaveURL(/\/connexion$/);
  await page.goto("/tuteur/journal");
  await expect(page).toHaveURL(/\/connexion$/);
  await expect(page.getByRole("heading", { name: "Journal d'audit" })).toHaveCount(0);
});
