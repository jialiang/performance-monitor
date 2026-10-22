import globals from "globals";
import importX from "eslint-plugin-import-x";
import js from "@eslint/js";
import tseslint from "typescript-eslint";

import { createTypeScriptImportResolver } from "eslint-import-resolver-typescript";

import { defineConfig, globalIgnores } from "eslint/config";

export default defineConfig([
  globalIgnores(["lib/"]),
  {
    files: ["**/*.{js,mjs,ts}"],
    plugins: { js },
    extends: ["js/recommended"],
    languageOptions: {
      globals: globals.node,
    },
  },
  {
    files: ["src/**/*.ts"],
    extends: [
      tseslint.configs.recommended,
      importX.flatConfigs.recommended,
      importX.flatConfigs.typescript,
    ],
    settings: {
      "import-x/resolver-next": [createTypeScriptImportResolver()],
    },
  },
]);
