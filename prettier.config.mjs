export default {
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
