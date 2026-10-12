import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { AstBuilder, compile, GherkinClassicTokenMatcher, Parser } from "@cucumber/gherkin";
import { IdGenerator } from "@cucumber/messages";
import { describe, it } from "vitest";

/** Une définition d'étape : une expression régulière sur le texte de l'étape (sans mot-clé) et son action. */
export interface StepDefinition<C> {
  readonly pattern: RegExp;
  run(context: C, ...captures: string[]): Promise<void>;
}

export const FEATURES_DIR = fileURLToPath(new URL("../../../../features/", import.meta.url));

/**
 * Exécute un fichier .feature (Gherkin, en français) : un test Vitest par scénario, les étapes
 * étant reliées aux définitions par expression régulière. Une étape sans définition, ou avec
 * plusieurs, fait échouer le scénario : rien n'est ignoré en silence.
 */
export function runFeature<C>(
  file: string,
  steps: ReadonlyArray<StepDefinition<C>>,
  hooks: { create(): Promise<C>; dispose(context: C): Promise<void> },
): void {
  const source = readFileSync(`${FEATURES_DIR}${file}`, "utf8");
  const newId = IdGenerator.uuid();
  const document = new Parser(new AstBuilder(newId), new GherkinClassicTokenMatcher()).parse(source);
  const pickles = compile(document, file, newId);
  const featureName = document.feature?.name ?? file;

  describe(`${featureName} [${file}]`, () => {
    for (const pickle of pickles) {
      it(pickle.name, async () => {
        const context = await hooks.create();
        try {
          for (const step of pickle.steps) {
            const matches = steps
              .map((definition) => ({ definition, match: definition.pattern.exec(step.text) }))
              .filter((candidate) => candidate.match !== null);
            if (matches.length !== 1) {
              throw new Error(
                `${matches.length === 0 ? "Étape non définie" : "Étape ambiguë"} : « ${step.text} »`,
              );
            }
            const [{ definition, match }] = matches as [
              { definition: StepDefinition<C>; match: RegExpExecArray },
            ];
            await definition.run(context, ...match.slice(1));
          }
        } finally {
          await hooks.dispose(context);
        }
      });
    }
  });
}
