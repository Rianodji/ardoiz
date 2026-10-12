import { defineConfig } from "vitest/config";

/** Les packages internes sont résolus vers leurs sources TypeScript pendant les tests. */
const sourceConditions = {
  resolve: { conditions: ["@ardoiz/source", "module", "browser", "development|production"] },
  ssr: { resolve: { conditions: ["@ardoiz/source", "module", "node", "development|production"] } },
};

export default defineConfig({
  test: {
    projects: [
      {
        ...sourceConditions,
        test: {
          name: "api",
          root: "apps/api",
          include: ["test/**/*.test.ts"],
          exclude: ["test/**/*.int.test.ts"],
        },
      },
      {
        ...sourceConditions,
        test: {
          name: "api-integration",
          root: "apps/api",
          include: ["test/**/*.int.test.ts"],
          globalSetup: ["test/integration/globalSetup.ts"],
          testTimeout: 20_000,
          hookTimeout: 120_000, // premier démarrage du conteneur PostgreSQL
          fileParallelism: false, // une seule base partagée par la suite
        },
      },
      {
        // Reprend la configuration Vite du front (plugin React, conditions de résolution).
        extends: "./apps/web/vite.config.ts",
        test: {
          name: "web",
          root: "apps/web",
          environment: "jsdom",
          include: ["test/**/*.test.{ts,tsx}"],
        },
      },
      {
        ...sourceConditions,
        test: { name: "contracts", root: "packages/contracts", include: ["test/**/*.test.ts"] },
      },
      {
        ...sourceConditions,
        test: {
          name: "content-schema",
          root: "packages/content-schema",
          include: ["test/**/*.test.ts"],
        },
      },
    ],
  },
});
