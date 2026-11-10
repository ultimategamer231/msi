import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import tseslint from "typescript-eslint";

const noFloatMoney = [
  {
    object: "Number",
    property: "parseFloat",
    message: "No floats (CLAUDE.md rule 1). Parse money with the cents parsers in src/lib.",
  },
  {
    object: "Math",
    property: "round",
    message: "No float rounding. Money rounding lives in Postgres (round half up on integers).",
  },
];

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    files: ["**/*.ts", "**/*.tsx"],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/no-misused-promises": ["error", { checksVoidReturn: { attributes: false } }],
      "@typescript-eslint/consistent-type-imports": ["error", { fixStyle: "inline-type-imports" }],
      "@typescript-eslint/no-non-null-assertion": "error",
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
      "no-restricted-globals": [
        "error",
        {
          name: "parseFloat",
          message: "No floats (CLAUDE.md rule 1). Parse money with the cents parsers in src/lib.",
        },
      ],
      "no-restricted-properties": ["error", ...noFloatMoney],
      "no-restricted-syntax": [
        "error",
        {
          selector: "CallExpression[callee.property.name='toFixed']",
          message: "toFixed works on floats. Format money with formatMoney() in src/lib/format.ts.",
        },
      ],
      eqeqeq: ["error", "always"],
    },
  },
  {
    files: ["**/*.mjs", "**/*.js"],
    ...tseslint.configs.disableTypeChecked,
  },
  globalIgnores([
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    "coverage/**",
    "playwright-report/**",
    "test-results/**",
    "docs/**",
    "supabase/**",
  ]),
]);

export default eslintConfig;
