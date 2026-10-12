import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Plugin } from "vite";

/**
 * Ressources d'Excalidraw servies par notre origine, pour respecter la CSP de production sans l'ouvrir :
 * - polices sous /assets/excalidraw/fonts/ (font-src 'self'), au lieu du CDN par défaut. La police de
 *   repli CJK (Xiaolai, 13 Mo) n'est pas embarquée (verdict L4, S-2) : l'E2E vérifie qu'un texte français
 *   (accents, ligatures, guillemets) s'affiche sans elle, sans police manquante ni violation de CSP ;
 * - adresse de repli des polices : Excalidraw ajoute TOUJOURS le CDN esm.sh après notre adresse, et le
 *   navigateur le signale comme une violation de la CSP. Ce repli est remplacé par notre origine. Si le
 *   motif change (mise à jour d'Excalidraw), la construction échoue au lieu de laisser passer le CDN.
 */
const SOURCE = fileURLToPath(
  new URL("../../node_modules/@excalidraw/excalidraw/dist/prod/fonts/", import.meta.url),
);
const PREFIX = "/assets/excalidraw/fonts/";
const FALLBACK_URL = /"ASSETS_FALLBACK_URL",`https:\/\/esm\.sh\/.*?\/dist\/prod\/`/s;
const OWN_FALLBACK = '"ASSETS_FALLBACK_URL",`${window.location.origin}/assets/excalidraw/`';

function withoutCdnFallback(code: string, id: string): string | null {
  if (!code.includes("https://esm.sh/")) return null;
  if (!FALLBACK_URL.test(code))
    throw new Error(`Repli CDN d'Excalidraw introuvable dans ${id} : vérifier la mise à jour.`);
  return code.replace(FALLBACK_URL, OWN_FALLBACK);
}

function fontFiles(): string[] {
  return readdirSync(SOURCE)
    .filter((family) => family !== "Xiaolai" && statSync(join(SOURCE, family)).isDirectory())
    .flatMap((family) =>
      readdirSync(join(SOURCE, family))
        .filter((file) => file.endsWith(".woff2"))
        .map((file) => `${family}/${file}`),
    );
}

export function excalidrawAssets(): Plugin {
  return {
    name: "ardoiz-excalidraw-assets",
    enforce: "pre",
    transform(code, id) {
      if (id.includes("@excalidraw/excalidraw") && /\.m?js(\?|$)/.test(id)) {
        const patched = withoutCdnFallback(code, id);
        return patched === null ? null : { code: patched, map: null };
      }
      return null;
    },
    configureServer(server) {
      const files = new Set(fontFiles());
      server.middlewares.use((request, response, next) => {
        const url = request.url ?? "";
        const relative = url.startsWith(PREFIX)
          ? decodeURIComponent(url.slice(PREFIX.length).split("?")[0] ?? "")
          : "";
        if (!files.has(relative)) {
          next();
          return;
        }
        response.setHeader("content-type", "font/woff2");
        response.end(readFileSync(join(SOURCE, relative)));
      });
    },
    generateBundle() {
      for (const file of fontFiles()) {
        this.emitFile({
          type: "asset",
          fileName: `assets/excalidraw/fonts/${file}`,
          source: readFileSync(join(SOURCE, file)),
        });
      }
    },
  };
}
