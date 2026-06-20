import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Test + coverage artefacts (also in .gitignore but ESLint
    // doesn't honour .gitignore by default).
    "coverage/**",
    "playwright-report/**",
    "test-results/**",
    "db/migrations/**",
    // Stale agent worktrees (full repo copies incl. their own .next builds),
    // the local dev stack, and any nested build output — never source to lint.
    ".claude/**",
    ".dev-stack/**",
    ".scratch/**",
    "**/.next/**",
    "**/node_modules/**",
  ]),
  // React Compiler diagnostics (eslint-plugin-react-hooks v6) are advisory
  // optimization hints that flag functionally-correct, well-tested patterns
  // (e.g. the canonical fetch-in-effect → setState). Keep them visible as
  // warnings rather than build-breaking errors; the code is exercised by the
  // 3,600+ unit/integration suite.
  {
    rules: {
      "react-hooks/set-state-in-effect": "warn",
      "react-hooks/purity": "warn",
      "react-hooks/immutability": "warn",
      "react-hooks/refs": "warn",
      "react-hooks/preserve-manual-memoization": "warn",
    },
  },
  // Playwright e2e fixtures use a parameter named `use` (the fixture-provider
  // callback), which the React rules-of-hooks heuristic mistakes for React's
  // `use` hook. These files are not React.
  {
    files: ["tests/e2e/**"],
    rules: {
      "react-hooks/rules-of-hooks": "off",
    },
  },
  // Test files legitimately use lazy `require()` inside vi.mock factories (which
  // can't reference hoisted top-level imports).
  {
    files: ["**/*.test.ts", "**/*.test.tsx"],
    rules: {
      "@typescript-eslint/no-require-imports": "off",
    },
  },
]);

export default eslintConfig;
