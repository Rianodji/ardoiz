import { e2eState, expect, loginLearner, loginTutor, test } from "../fixtures.js";

/** Une image PNG de 1 × 1 pixel, valide. */
const PNG_1PX =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

/**
 * Critère du lot L4 : dessiner, recharger, retrouver le dessin, rendre, voir la copie verrouillée —
 * avec la CSP de production, sans aucune violation (R11, ADR-0004).
 */
test("dessiner, recharger, retrouver le dessin, rendre, voir la copie verrouillée", async ({ page }) => {
  const state = e2eState();
  await loginLearner(page, state);
  await page.goto("/eleve/devoirs");
  await page
    .getByRole("listitem")
    .filter({ hasText: "Géométrie : tracer un triangle" })
    .getByRole("button", { name: "Commencer" })
    .click();
  await expect(page.getByRole("heading", { name: "Géométrie : tracer un triangle" })).toBeVisible();
  const canvas = page.locator(".notebook-canvas canvas.interactive");
  await expect(canvas).toBeVisible();

  // Un rectangle à la souris, puis un texte, avec les outils de la barre d'Excalidraw.
  const area = page.locator(".notebook-canvas");
  await area.scrollIntoViewIfNeeded();
  const box = await area.boundingBox();
  if (box === null) throw new Error("Cahier absent.");
  await page.locator("label", { has: page.getByTestId("toolbar-rectangle") }).click();
  await page.mouse.move(box.x + box.width / 2 - 100, box.y + 160);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 60, box.y + 260, { steps: 8 });
  await page.mouse.up();

  // Un texte qui ressemble à du HTML reste du texte dessiné sur le canevas (R4).
  await page.locator("label", { has: page.getByTestId("toolbar-text") }).click();
  await page.mouse.click(box.x + box.width / 2 - 100, box.y + 320);
  await page.keyboard.type('<img src=x onerror="window.__xss=1">');
  await page.keyboard.press("Escape");

  // Un texte français (accents, ligature, guillemets) : affiché sans police de repli CJK (verdict L4, S-2).
  await page.locator("label", { has: page.getByTestId("toolbar-text") }).click();
  await page.mouse.click(box.x + box.width / 2 - 100, box.y + 380);
  await page.keyboard.type("Côté hypoténuse : 5 cm — « œuf » à l'ébène, ça !");
  await page.keyboard.press("Escape");

  // Une photo importée : réencodée par le serveur, affichée depuis la route autorisée (R14, CSP).
  await page.getByLabel("Photo à ajouter au cahier").setInputFiles({
    name: "figure.png",
    mimeType: "image/png",
    buffer: Buffer.from(PNG_1PX, "base64"),
  });
  await expect
    .poll(async () =>
      page.evaluate(() =>
        performance.getEntriesByType("resource").some((entry) => entry.name.includes("/api/notebook-media/")),
      ),
    )
    .toBe(true);

  // Sauvegarde automatique, avec son indicateur.
  await expect(page.getByText("Enregistré", { exact: true })).toBeVisible({ timeout: 20_000 });
  const attemptId = page.url().split("/copie/")[1] ?? "";
  const scene = async () =>
    page.evaluate(async (id) => {
      const response = await fetch(`/api/attempts/${id}`);
      const body = (await response.json()) as {
        status: string;
        answers: Record<string, { elements?: Array<{ type: string; text?: string }> }>;
      };
      return { status: body.status, elements: Object.values(body.answers)[0]?.elements ?? [] };
    }, attemptId);
  const saved = await scene();
  expect(saved.elements.map((element) => element.type).sort()).toEqual([
    "image",
    "rectangle",
    "text",
    "text",
  ]);
  expect(
    saved.elements.filter((element) => element.type === "text").map((element) => element.text),
  ).toContain('<img src=x onerror="window.__xss=1">');

  // Recharger : le dessin revient.
  await page.reload();
  await expect(page.locator(".notebook-canvas canvas.interactive")).toBeVisible();
  expect((await scene()).elements).toHaveLength(4);
  // Après rechargement, les textes sont redessinés : aucune police manquante (voir la fixture).
  await page.waitForTimeout(1_500);
  expect(await page.locator("img[src='x']").count()).toBe(0);
  expect(await page.evaluate(() => (window as { __xss?: number }).__xss)).toBeUndefined();

  // Rendre : la copie est verrouillée (lecture seule, plus d'outil d'import).
  await page.getByRole("button", { name: "Rendre mon devoir" }).click();
  await page.getByRole("button", { name: "Oui, rendre mon devoir" }).click();
  await expect(page.getByText(/Ton devoir est rendu\. Ton tuteur va le corriger/)).toBeVisible();
  await expect(page.getByRole("button", { name: /Rendre mon devoir/ })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Ajouter une photo" })).toHaveCount(0);
  await page.reload();
  await expect(page.getByText(/Ton devoir est rendu\. Ton tuteur va le corriger/)).toBeVisible();
  expect((await scene()).status).toBe("submitted");
});

/** Le tuteur annote la copie rendue sur son calque, sans toucher au dessin de l'élève (R6). */
test("le tuteur pose un tampon sur le calque d'annotation de la copie rendue", async ({ page }) => {
  const state = e2eState();
  await loginTutor(page, state);
  await page.goto("/tuteur/corrections");
  await page.getByRole("link", { name: /Géométrie : tracer un triangle/ }).click();
  await expect(page.getByRole("toolbar", { name: "Outils d'annotation" })).toBeVisible();
  const attemptId = page.url().split("/tuteur/corrections/")[1] ?? "";
  const before = await page.evaluate(async (id) => {
    const body = (await (await fetch(`/api/grading/attempts/${id}`)).json()) as { answersSha256: string };
    return body.answersSha256;
  }, attemptId);
  await page.getByRole("button", { name: "Tampon ✓" }).click();
  await page.getByRole("button", { name: "Enregistrer le calque" }).click();
  await expect(page.getByText("Calque enregistré.")).toBeVisible();
  const after = await page.evaluate(async (id) => {
    const body = (await (await fetch(`/api/grading/attempts/${id}`)).json()) as {
      answersSha256: string;
      annotations: Record<string, { elements: Array<{ type: string; text?: string }> }>;
      answers: Record<string, { elements?: unknown[] }>;
    };
    return {
      sha: body.answersSha256,
      stamps: Object.values(body.annotations).flatMap((layer) =>
        layer.elements.map((element) => element.text),
      ),
      studentElements: Object.values(body.answers)[0]?.elements?.length ?? 0,
    };
  }, attemptId);
  expect(after.stamps).toEqual(["✓"]);
  expect(after.sha).toBe(before);
  expect(after.studentElements).toBe(4);
});
