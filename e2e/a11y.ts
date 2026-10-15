import type { Page } from "@playwright/test";
import { mkdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";

/**
 * Vérifications de la charte §8 (L8), écran par écran, sous la CSP de production :
 * contrastes et règles WCAG par axe-core, taille des cibles, tabulation avec focus visible, absence de
 * défilement horizontal. axe-core est une dépendance de DÉVELOPPEMENT (MPL-2.0), jamais livrée : il est
 * injecté par le protocole du navigateur (`page.evaluate`), que la CSP ne bloque pas, ce qui évite
 * d'ouvrir la CSP pour les tests.
 */
const AXE_SOURCE = readFileSync(createRequire(import.meta.url).resolve("axe-core/axe.min.js"), "utf8");

/** Le cahier (Excalidraw) est une bibliothèque tierce, couverte par ses propres tests (L4, tablette). */
const THIRD_PARTY = ".notebook-canvas, .excalidraw";

declare global {
  interface Window {
    axe?: {
      run: (
        context: unknown,
        options: unknown,
      ) => Promise<{
        violations: Array<{ id: string; impact: string | null; nodes: Array<{ target: unknown[] }> }>;
      }>;
    };
  }
}

/** Violations WCAG 2.2 A et AA relevées par axe-core (contrastes compris). */
export async function axeViolations(page: Page): Promise<string[]> {
  if (!(await page.evaluate(() => window.axe !== undefined))) await page.evaluate(AXE_SOURCE);
  return page.evaluate(async (exclude) => {
    const axe = window.axe;
    if (axe === undefined) return ["axe-core absent"];
    const result = await axe.run(
      { exclude: [exclude] },
      { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"] } },
    );
    return result.violations.map(
      (violation) =>
        `${violation.id} (${violation.impact ?? "?"}) : ${violation.nodes
          .slice(0, 4)
          .map((node) => JSON.stringify(node.target))
          .join(", ")}`,
    );
  }, THIRD_PARTY);
}

/**
 * Cibles trop petites : 56 px dans l'espace élève, 48 px ailleurs (charte §8), en hauteur et en largeur.
 * Exception de WCAG 2.5.8 : un lien dans une phrase. Une case à cocher se mesure par son libellé.
 */
export async function smallTargets(page: Page): Promise<string[]> {
  return page.evaluate((exclude) => {
    const min = document.querySelector('.app[data-space="learner"]') === null ? 48 : 56;
    const selector =
      'a[href], button, input:not([type="hidden"]), select, textarea, summary, [role="tab"], [tabindex]:not([tabindex="-1"])';
    const failures: string[] = [];
    for (const element of document.querySelectorAll<HTMLElement>(selector)) {
      if (element.closest(exclude) !== null || element.classList.contains("skip-link")) continue;
      if (element.getClientRects().length === 0 || getComputedStyle(element).visibility === "hidden")
        continue;
      let target: HTMLElement = element;
      if (element.matches('input[type="checkbox"], input[type="radio"]')) {
        const id = element.getAttribute("id");
        const label =
          (id === null ? null : document.querySelector<HTMLElement>(`label[for="${CSS.escape(id)}"]`)) ??
          element.closest("label");
        if (label !== null) target = label;
      }
      if (element.tagName === "A" && getComputedStyle(element).display === "inline") {
        const block = element.parentElement;
        const inSentence = block !== null && block.textContent.trim() !== element.textContent.trim();
        if (inSentence || element.closest(".markdown, .lesson-content") !== null) continue;
      }
      const box = target.getBoundingClientRect();
      if (box.height + 0.5 < min || box.width + 0.5 < min) {
        const name = (element.getAttribute("aria-label") ?? element.textContent).trim().slice(0, 40);
        failures.push(
          `${element.tagName.toLowerCase()} « ${name} » : ${String(Math.round(box.width))} × ${String(Math.round(box.height))} px (minimum ${String(min)})`,
        );
      }
    }
    return failures;
  }, THIRD_PARTY);
}

/**
 * Tabulation : chaque élément atteint au clavier est visible et porte un indicateur de focus (anneau
 * d'au moins 2 px). Le parcours s'arrête quand il revient au premier élément, ou après `max` pas.
 */
export async function keyboardFocusProblems(
  page: Page,
  max = 80,
): Promise<{ reached: number; problems: string[] }> {
  await page.evaluate(() => {
    (document.activeElement as HTMLElement | null)?.blur();
    window.scrollTo(0, 0);
  });
  await page.locator("body").focus();
  const seen: string[] = [];
  const problems: string[] = [];
  for (let step = 0; step < max; step++) {
    await page.keyboard.press("Tab");
    const info = await page.evaluate((exclude) => {
      const element = document.activeElement as HTMLElement | null;
      if (element === null || element === document.body) return null;
      if (element.closest(exclude) !== null) return { key: "tiers", ok: true, name: "" };
      const ringOf = (candidate: HTMLElement) => {
        const style = getComputedStyle(candidate);
        return style.outlineStyle !== "none" && parseFloat(style.outlineWidth) >= 2;
      };
      let ring = ringOf(element);
      // Bouton radio déguisé en pastille : l'anneau est sur son libellé (`label:has(input:focus-visible)`).
      if (!ring && element.matches('input[type="radio"], input[type="checkbox"]')) {
        const label = element.closest("label");
        ring = label !== null && ringOf(label);
      }
      const box = element.getBoundingClientRect();
      const label = element.closest("label");
      const visibleBox =
        box.width >= 2 && box.height >= 2 ? box : label !== null ? label.getBoundingClientRect() : box;
      const path: string[] = [];
      for (
        let node: Element | null = element;
        node !== null && node !== document.body;
        node = node.parentElement
      ) {
        path.unshift(`${node.tagName}${String([...(node.parentElement?.children ?? [])].indexOf(node))}`);
      }
      return {
        key: path.join(">"),
        ok: ring && visibleBox.width >= 2 && visibleBox.height >= 2,
        name: `${element.tagName.toLowerCase()} « ${(element.getAttribute("aria-label") ?? element.textContent).trim().slice(0, 40)} »`,
      };
    }, THIRD_PARTY);
    if (info === null) continue;
    if (seen.length > 0 && info.key === seen[0]) break;
    if (!seen.includes(info.key)) {
      seen.push(info.key);
      if (!info.ok) problems.push(`focus invisible sur ${info.name}`);
    }
  }
  return { reached: seen.length, problems };
}

/** Défilement horizontal de la page (360 px de large, charte §8) : 0 si aucun, sinon les éléments qui débordent. */
export async function horizontalOverflow(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const width = document.documentElement.clientWidth;
    if (document.documentElement.scrollWidth <= width) return [];
    const culprits: string[] = [];
    for (const element of document.querySelectorAll<HTMLElement>("body *")) {
      const box = element.getBoundingClientRect();
      if (box.right <= width + 0.5 || box.width === 0) continue;
      // On ne garde que les éléments les plus profonds : leurs parents débordent à cause d'eux.
      if ([...element.children].some((child) => child.getBoundingClientRect().right > width + 0.5)) continue;
      // Ce qui défile dans une boîte de tableau ne fait pas défiler la page, sauf un élément positionné.
      if (element.closest(".table-box") !== null && getComputedStyle(element).position !== "absolute")
        continue;
      culprits.push(
        `${element.tagName.toLowerCase()}.${element.className} (${String(Math.round(box.right))} px)`,
      );
    }
    return culprits.length === 0
      ? [`page de ${String(document.documentElement.scrollWidth)} px`]
      : culprits.slice(0, 5);
  });
}

/** Captures d'écran pour le rapport, seulement si E2E_CAPTURES désigne un dossier (jamais en CI). */
export async function capture(page: Page, name: string, fullPage = true): Promise<void> {
  const directory = process.env["E2E_CAPTURES"];
  if (directory === undefined || directory === "") return;
  mkdirSync(directory, { recursive: true });
  await page.evaluate(async () => {
    window.scrollTo(0, 0);
    await document.fonts.ready;
  });
  await page.screenshot({ path: join(directory, `${name}.png`), fullPage, animations: "disabled" });
}
