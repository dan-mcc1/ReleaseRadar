import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import tseslint from "typescript-eslint";
import { defineConfig, globalIgnores } from "eslint/config";

export default defineConfig([
  globalIgnores(["dist"]),
  {
    files: ["**/*.{ts,tsx}"],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      // Rules of Hooks plus the React Compiler's checks: code that breaks
      // them is silently skipped by the compiler (babel-plugin-react-compiler).
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      ecmaVersion: 2022,
      globals: globals.browser,
    },
    rules: {
      // `({ _type, ...rest }) => rest` is how we drop a key.
      "@typescript-eslint/no-unused-vars": ["error", { ignoreRestSiblings: true }],
      // Only affects hot reload in dev (files that export helpers next to a
      // component reload fully instead of keeping state).
      "react-refresh/only-export-components": ["warn", { allowConstantExport: true }],
    },
  },
]);
