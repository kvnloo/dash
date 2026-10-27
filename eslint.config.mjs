import parser from "@typescript-eslint/parser";
import typescript from "@typescript-eslint/eslint-plugin";

// Deliberately small correctness baseline; type safety is gated separately by tsc.
export default [
  { plugins: { "@typescript-eslint": typescript } },
  { ignores: ["**/node_modules/**", "**/.expo/**", "**/dist/**", "**/build/**", "**/coverage/**", "**/*.bak*", "server/**"] },
  {
    files: ["app/**/*.{ts,tsx}", "bridge/**/*.ts", "shared/**/*.ts", "scripts/**/*.{ts,mjs}", "*.{ts,mjs}"],
    languageOptions: { parser, parserOptions: { ecmaVersion: "latest", sourceType: "module", ecmaFeatures: { jsx: true } } },
    rules: {
      "no-debugger": "error",
      "no-dupe-args": "error",
      "no-duplicate-case": "error",
      "no-unreachable": "error",
      "no-unsafe-finally": "error",
      "valid-typeof": "error"
    }
  }
];
