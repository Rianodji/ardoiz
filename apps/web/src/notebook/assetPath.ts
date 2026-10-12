/**
 * Adresse des ressources d'Excalidraw (polices) : NOTRE origine (CSP : font-src 'self'). Ce module est
 * importé par main.tsx, donc évalué avant le chunk d'Excalidraw, qui lit cette variable à son chargement.
 */
declare global {
  interface Window {
    EXCALIDRAW_ASSET_PATH?: string;
  }
}

window.EXCALIDRAW_ASSET_PATH = "/assets/excalidraw/";

export {};
