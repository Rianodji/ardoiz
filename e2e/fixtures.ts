import { test as base, expect, type Page } from "@playwright/test";
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";

export interface E2eState {
  readonly baseURL: string;
  readonly spaceCode: string;
  readonly learner: { readonly username: string; readonly password: string; readonly id: string };
  readonly tutor: {
    readonly email: string;
    readonly password: string;
    readonly totpSecret: string;
    readonly usedStep: number;
  };
  readonly assignmentId: string;
  readonly lessonId: string;
}

export function e2eState(): E2eState {
  return JSON.parse(readFileSync(process.env["E2E_STATE_FILE"] ?? "", "utf8")) as E2eState;
}

declare global {
  interface Window {
    __cspViolations?: string[];
  }
}

/**
 * Toute violation de la CSP de production fait échouer le test (verdict L3, §6) : on écoute
 * l'événement `securitypolicyviolation` dans chaque page et les messages de la console.
 */
export const test = base.extend<{ cspViolations: string[] }>({
  cspViolations: [
    async ({ page }, use) => {
      const violations: string[] = [];
      await page.addInitScript(() => {
        document.addEventListener("securitypolicyviolation", (event) => {
          const target =
            event.target instanceof Element
              ? `${event.target.tagName.toLowerCase()}.${event.target.className}`
              : "";
          (window.__cspViolations ??= []).push(
            `${event.violatedDirective} ${event.blockedURI.slice(0, 120)} ${target.slice(0, 80)} ${event.sample.slice(0, 80)}`,
          );
        });
      });
      page.on("console", (message) => {
        if (/Content Security Policy|Refused to/i.test(message.text()))
          violations.push(message.text().slice(0, 300));
      });
      await use(violations);
      const inPage = await page.evaluate(() => window.__cspViolations ?? []).catch(() => [] as string[]);
      expect([...violations, ...inPage], "violations de la CSP").toEqual([]);
    },
    // Automatique : tous les tests sont surveillés, sans avoir à le demander.
    { auto: true },
  ],
});

export { expect };

/** Connexion de l'élève par l'interface, comme un enfant (code d'espace, pseudo, mot de passe). */
export async function loginLearner(page: Page, state: E2eState): Promise<void> {
  await page.goto("/connexion");
  await page.getByLabel("Code de ton espace").fill(state.spaceCode);
  await page.getByLabel("Ton pseudo").fill(state.learner.username);
  await page.getByLabel("Mot de passe").fill(state.learner.password);
  await page.getByRole("button", { name: "Me connecter" }).click();
  await expect(page.getByRole("heading", { name: /Bonjour/ })).toBeVisible();
}

function base32Decode(input: string): Buffer {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const char of input) {
    value = (value << 5) | alphabet.indexOf(char);
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

function totpAt(secret: string, step: number): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const digest = createHmac("sha1", base32Decode(secret)).update(counter).digest();
  const offset = (digest[digest.length - 1] ?? 0) & 0x0f;
  return String((digest.readUInt32BE(offset) & 0x7fffffff) % 1_000_000).padStart(6, "0");
}

let lastTutorStep = 0;

/**
 * Connexion du tuteur avec son second facteur (R7), par l'API du navigateur : la session est posée
 * dans le contexte de la page. Un code TOTP ne sert qu'une fois : on attend un pas neuf si besoin.
 */
export async function loginTutor(page: Page, state: E2eState): Promise<void> {
  const used = Math.max(state.tutor.usedStep, lastTutorStep);
  while (Math.floor(Date.now() / 30_000) <= used) await page.waitForTimeout(1_000);
  const step = Math.floor(Date.now() / 30_000);
  lastTutorStep = step;
  const headers = { origin: state.baseURL };
  const login = await page.request.post("/api/auth/login/adult", {
    headers,
    data: { email: state.tutor.email, password: state.tutor.password },
  });
  expect(login.status()).toBe(200);
  const verified = await page.request.post("/api/auth/totp/verify", {
    headers,
    data: { code: totpAt(state.tutor.totpSecret, step) },
  });
  expect(verified.status(), await verified.text()).toBe(200);
}
