import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { cruise, type ICruiseResult, type IConfiguration } from "dependency-cruiser";
import { describe, expect, it } from "vitest";

/** La configuration réelle de la CI, chargée telle quelle : on teste les règles, pas une copie. */
const config = createRequire(import.meta.url)("../../../../.dependency-cruiser.cjs") as IConfiguration;
const fixture = (name: string) => fileURLToPath(new URL(`./fixtures/${name}/src`, import.meta.url));

async function violationsIn(name: string): Promise<{ rule: string; from: string; to: string }[]> {
  const { output } = await cruise([fixture(name)], {
    ruleSet: config,
    validate: true,
    tsPreCompilationDeps: true,
    doNotFollow: { path: "node_modules" },
  });
  const result = output as ICruiseResult;
  return result.summary.violations.map((violation) => ({
    rule: violation.rule.name,
    from: violation.from.replace(/^.*\/src\//, "src/"),
    to: violation.to.replace(/^.*\/src\//, "src/"),
  }));
}

describe("Règles d'architecture (dependency-cruiser, ADR-0001)", () => {
  it("échoue quand le domaine importe l'infrastructure", async () => {
    expect(await violationsIn("violations")).toContainEqual({
      rule: "domaine-pur",
      from: "src/curriculum/domain/Lesson.ts",
      to: "src/curriculum/infrastructure/PgLessonRepository.ts",
    });
  });

  it("échoue quand un module importe l'intérieur d'un autre module", async () => {
    expect(await violationsIn("violations")).toContainEqual({
      rule: "modules-par-api-publique",
      from: "src/curriculum/domain/Lesson.ts",
      to: "src/identity/domain/Guardian.ts",
    });
  });

  it("échoue quand le domaine importe un module natif (E/S)", async () => {
    const violations = await violationsIn("violations");
    const nativeImport = violations.find((v) => v.rule === "domaine-pur" && /^(node:)?crypto$/.test(v.to));
    expect(nativeImport?.from).toBe("src/curriculum/domain/Lesson.ts");
  });

  it("échoue quand l'application importe la plateforme, ou le noyau un module", async () => {
    const rules = (await violationsIn("violations")).map((v) => v.rule);
    expect(rules).toContain("application-sans-infrastructure");
    expect(rules).toContain("noyau-partage-autonome");
  });

  it("accepte un arbre qui respecte les frontières (pas de faux positif)", async () => {
    expect(await violationsIn("clean")).toEqual([]);
  });
});
