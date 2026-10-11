import js from "@eslint/js";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";
import tseslint from "typescript-eslint";

/** Interdits sans justification (règle 16 du prompt développeur) : tests isolés ou désactivés. */
const FOCUSED_OR_SKIPPED_TESTS = ["it", "test", "describe"].flatMap((object) =>
  ["only", "skip", "todo"].map((property) => ({
    object,
    property,
    message: "Test isolé ou désactivé interdit (règle 16).",
  })),
);

export default tseslint.config(
  {
    ignores: ["**/dist/**", "**/coverage/**", "**/node_modules/**", "**/test/architecture/fixtures/**"],
  },
  {
    // Aucune directive « eslint-disable » ne peut affaiblir une règle (règle 16).
    linterOptions: { noInlineConfig: true, reportUnusedDisableDirectives: "error" },
  },
  js.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  {
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/ban-ts-comment": [
        "error",
        { "ts-expect-error": true, "ts-ignore": true, "ts-nocheck": true },
      ],
      "@typescript-eslint/consistent-type-imports": "error",
      "@typescript-eslint/restrict-template-expressions": ["error", { allowNumber: true }],
      "no-restricted-properties": ["error", ...FOCUSED_OR_SKIPPED_TESTS],
      eqeqeq: "error",
      "no-console": "error",
    },
  },
  {
    files: ["**/*.js", "**/*.cjs", "**/*.mjs"],
    ...tseslint.configs.disableTypeChecked,
    languageOptions: { ...tseslint.configs.disableTypeChecked.languageOptions, globals: globals.node },
  },
  {
    // Domaine pur (règle 11) : ni horloge système, ni aléa ; on passe par les ports Clock et IdGenerator.
    files: ["apps/api/src/*/domain/**/*.ts"],
    rules: {
      "no-restricted-properties": [
        "error",
        { object: "Date", property: "now", message: "Utiliser le port Clock (règle 11)." },
        { object: "Math", property: "random", message: "Utiliser un port de génération (règle 11)." },
      ],
      "no-restricted-syntax": [
        "error",
        {
          selector: "NewExpression[callee.name='Date'][arguments.length=0]",
          message: "Utiliser le port Clock (règle 11).",
        },
      ],
    },
  },
  {
    files: ["apps/web/**/*.{ts,tsx}"],
    languageOptions: { globals: globals.browser },
    plugins: { "react-hooks": reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,
      // Aucun HTML utilisateur rendu tel quel (R4, ADR-0005) ; seul le composant KaTeX en aura le droit (L2).
      "no-restricted-syntax": [
        "error",
        {
          selector: "JSXAttribute[name.name='dangerouslySetInnerHTML']",
          message: "HTML brut interdit (R4, ADR-0005).",
        },
        {
          selector: "MemberExpression[property.name=/^(innerHTML|outerHTML)$/]",
          message: "HTML brut interdit (R4, ADR-0005).",
        },
      ],
    },
  },
);
