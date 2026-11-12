export default {
  plugins: ["@ianvs/prettier-plugin-sort-imports"],
  importOrder: ["<BUILTIN_MODULES>", "", "<THIRD_PARTY_MODULES>", "", "^[./]"],
  bracketSameLine: true,
  printWidth: 100,
  trailingComma: "es5",
  endOfLine: "crlf",
  overrides: [
    {
      // config.ts parses env.jsonc with JSON.parse, which rejects trailing commas.
      files: "*.jsonc",
      options: { trailingComma: "none" },
    },
  ],
};
