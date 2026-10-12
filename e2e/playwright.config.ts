import { defineConfig, devices } from "@playwright/test";

/**
 * Tests de bout en bout (L4) : la vraie application et la vraie CSP de production. Le serveur est
 * démarré par `globalSetup` (base jetable, données de démonstration) ; toute violation de CSP fait
 * échouer le test (voir `fixtures.ts`).
 */
export default defineConfig({
  testDir: "./tests",
  globalSetup: "./globalSetup.ts",
  globalTeardown: "./globalTeardown.ts",
  fullyParallel: false,
  workers: 1,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  reporter: [["list"]],
  // Adresse du serveur fixée par globalSetup, lue par chaque worker (lancé après lui).
  use: {
    baseURL: process.env["E2E_BASE_URL"],
    trace: "retain-on-failure",
    locale: "fr-FR",
    timezoneId: "Europe/Paris",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
