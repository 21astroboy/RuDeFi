import js from "@eslint/js";
import globals from "globals";

export default [
  { ignores: ["build/**", "node_modules/**"] },
  js.configs.recommended,
  {
    files: ["frontend/*.js"],
    languageOptions: {
      sourceType: "script",
      globals: { ...globals.browser, ...globals.es2021 },
    },
    rules: {
      // Classic script functions are also called by HTML onclick attributes.
      "no-unused-vars": "off",
      "preserve-caught-error": "off",
      "no-empty": ["error", { allowEmptyCatch: true }],
    },
  },
  {
    files: ["tests/**/*.cjs", "scripts/*.mjs"],
    languageOptions: { globals: globals.node },
    rules: { "no-unused-vars": ["error", { argsIgnorePattern: "^_" }] },
  },
];
