import type { Page } from "@playwright/test";
import { e2eState, expect, loginLearner, test } from "../fixtures.js";

/** Tablette en mode portrait, écran tactile (verdict L4 : émulation tactile en attendant l'essai réel du L7). */
test.use({ viewport: { width: 820, height: 1180 }, hasTouch: true, isMobile: true });

/** Un tracé au doigt : de vrais événements tactiles (début, déplacements, fin), envoyés par le protocole du navigateur. */
async function fingerStroke(page: Page, points: ReadonlyArray<readonly [number, number]>): Promise<void> {
  const cdp = await page.context().newCDPSession(page);
  const touch = (type: "touchStart" | "touchMove" | "touchEnd", point?: readonly [number, number]) =>
    cdp.send("Input.dispatchTouchEvent", {
      type,
      touchPoints:
        point === undefined ? [] : [{ x: point[0], y: point[1], id: 1, radiusX: 4, radiusY: 4, force: 0.6 }],
    });
  const [first, ...rest] = points;
  if (first === undefined) return;
  await touch("touchStart", first);
  for (const point of rest) await touch("touchMove", point);
  await touch("touchEnd");
  await cdp.detach();
}

test("sur tablette, l'élève trace au doigt et retrouve son tracé", async ({ page }) => {
  const state = e2eState();
  await loginLearner(page, state);
  await page.goto("/eleve/devoirs");
  await page
    .getByRole("listitem")
    .filter({ hasText: "Croquis sur tablette" })
    .getByRole("button", { name: "Commencer" })
    .tap();
  await expect(page.getByRole("heading", { name: "Croquis sur tablette" })).toBeVisible();
  const attemptId = page.url().split("/copie/")[1] ?? "";
  const area = page.locator(".notebook-canvas");
  await expect(area).toBeVisible();
  await area.scrollIntoViewIfNeeded();
  const box = await area.boundingBox();
  if (box === null) throw new Error("Cahier absent.");
  await page.locator("label", { has: page.getByTestId("toolbar-freedraw") }).tap();
  const x = box.x + box.width / 2;
  const y = box.y + 200;
  await fingerStroke(
    page,
    Array.from({ length: 12 }, (_, i) => [x - 120 + i * 20, y + Math.round(30 * Math.sin(i / 2))] as const),
  );
  await expect(page.getByText("Enregistré", { exact: true })).toBeVisible({ timeout: 20_000 });
  const types = await page.evaluate(async (id) => {
    const body = (await (await fetch(`/api/attempts/${id}`)).json()) as {
      answers: Record<string, { elements?: Array<{ type: string }> }>;
    };
    return Object.values(body.answers)[0]?.elements?.map((element) => element.type) ?? [];
  }, attemptId);
  expect(types).toEqual(["freedraw"]);
});
