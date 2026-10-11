import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

/**
 * En développement, Vite sert la SPA et relaie l'API : le navigateur ne voit qu'une origine,
 * comme en production où Fastify sert les deux (ADR-0006). `changeOrigin` reste à false :
 * l'en-tête Origin du navigateur parvient intact à l'API, qui le vérifie (R11).
 */
export default defineConfig({
  plugins: [react()],
  resolve: { conditions: ["@ardoiz/source"] },
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      "/api": { target: "http://127.0.0.1:3000", changeOrigin: false },
      "/healthz": { target: "http://127.0.0.1:3000", changeOrigin: false },
      "/readyz": { target: "http://127.0.0.1:3000", changeOrigin: false },
    },
  },
  build: {
    outDir: "dist",
    sourcemap: false,
    // Pas de module en ligne dans index.html : la CSP interdit les scripts en ligne (R11).
    modulePreload: { polyfill: false },
    assetsInlineLimit: 0,
  },
});
