import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Plugin } from "vite";

/**
 * Polices d'Excalidraw servies par notre origine sous /assets/excalidraw/fonts/ (CSP : font-src 'self'),
 * au lieu du CDN par défaut. La police chinoise (Xiaolai, 13 Mo) n'est pas embarquée : inutile ici.
 */
const SOURCE = fileURLToPath(
  new URL("../../node_modules/@excalidraw/excalidraw/dist/prod/fonts/", import.meta.url),
);
const PREFIX = "/assets/excalidraw/fonts/";
const SKIPPED = new Set(["Xiaolai"]);

function fontFiles(): string[] {
  return readdirSync(SOURCE)
    .filter((family) => !SKIPPED.has(family) && statSync(join(SOURCE, family)).isDirectory())
    .flatMap((family) =>
      readdirSync(join(SOURCE, family))
        .filter((file) => file.endsWith(".woff2"))
        .map((file) => `${family}/${file}`),
    );
}

export function excalidrawAssets(): Plugin {
  return {
    name: "ardoiz-excalidraw-assets",
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
