/**
 * Règles d'architecture (ADR-0001, règles 11 et 12 du prompt développeur).
 * Une violation fait échouer `npm run depcruise`, donc la CI, exactement comme un test.
 * Les chemins sont ancrés sur « src/ » pour que test/architecture puisse vérifier les règles
 * elles-mêmes sur un arbre fixture.
 */
const path = require("node:path");

const MODULES = "(identity|curriculum|scheduling|assessment|progress|feedback)";

module.exports = {
  forbidden: [
    {
      name: "modules-par-api-publique",
      comment: "Un module n'importe un autre module que par son index.ts (règle 12).",
      severity: "error",
      from: { path: `(^|/)src/${MODULES}/` },
      to: {
        path: `(^|/)src/${MODULES}/`,
        pathNot: ["(^|/)src/$2/", `(^|/)src/${MODULES}/index\\.ts$`],
      },
    },
    {
      name: "domaine-pur",
      comment:
        "Le domaine ne dépend que de lui-même et du noyau partagé : ni application, ni infrastructure, ni bibliothèque, ni module natif (règle 11).",
      severity: "error",
      from: { path: "(^|/)src/([^/]+)/domain/" },
      to: { pathNot: ["(^|/)src/$2/domain/", "(^|/)src/shared-kernel/"] },
    },
    {
      name: "application-sans-infrastructure",
      comment:
        "La couche application ne connaît ni les adaptateurs, ni la plateforme, ni les bibliothèques techniques.",
      severity: "error",
      from: { path: "(^|/)src/[^/]+/application/" },
      to: { path: ["/infrastructure/", "(^|/)src/platform/", "(^|/)src/app/", "node_modules"] },
    },
    {
      name: "application-sans-module-natif",
      comment: "Pas d'E/S Node dans la couche application : elle passe par des ports.",
      severity: "error",
      from: { path: "(^|/)src/[^/]+/application/" },
      to: { dependencyTypes: ["core"] },
    },
    {
      name: "noyau-partage-autonome",
      comment: "Le noyau partagé ne dépend de rien d'autre que de lui-même.",
      severity: "error",
      from: { path: "(^|/)src/shared-kernel/" },
      to: { pathNot: "(^|/)src/shared-kernel/" },
    },
    {
      name: "plateforme-sans-metier",
      comment: "Les adaptateurs techniques partagés ne dépendent d'aucun module métier.",
      severity: "error",
      from: { path: "(^|/)src/platform/" },
      to: { path: [`(^|/)src/${MODULES}/`, "(^|/)src/app/"] },
    },
    {
      name: "racine-de-composition-unique",
      comment: "Seul src/app/ assemble les modules ; personne ne l'importe.",
      severity: "error",
      from: { pathNot: "(^|/)src/app/" },
      to: { path: "(^|/)src/app/" },
    },
    { name: "pas-de-cycle", severity: "error", from: {}, to: { circular: true } },
    {
      name: "pas-d-import-introuvable",
      severity: "error",
      from: {},
      to: { couldNotResolve: true },
    },
  ],
  options: {
    doNotFollow: { path: "node_modules" },
    tsPreCompilationDeps: true,
    tsConfig: { fileName: path.join(__dirname, "apps/api/tsconfig.json") },
    enhancedResolveOptions: {
      conditionNames: ["@ardoiz/source", "import", "node", "default"],
      exportsFields: ["exports"],
      extensions: [".ts", ".js"],
    },
  },
};
