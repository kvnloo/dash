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
  },
  // Metro relay previews cannot load dynamic JS chunks on the native path.
  {
    files: ["app/src/**/*.{ts,tsx}"],
    ignores: ["app/src/**/*.web.ts", "app/src/**/*.web.tsx", "app/src/**/*.test.ts"],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector: "ImportExpression",
          message: "Dynamic import() can 404 in native Metro previews. Use a lazy require() inside the function instead."
        }
      ]
    }
  }
];
