import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    setupFiles: ['./tests/setup.ts'],
    include: [
      'tests/unit/**/*.test.ts',
      'tests/unit/**/*.test.tsx',
      'db/**/*.test.ts',
      'lib/**/*.test.ts',
      'lib/**/*.test.tsx',
      'app/**/*.test.ts',
      'app/**/*.test.tsx',
    ],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      // Enforced CI coverage gate (#108). The money path is the regression
      // backstop, so the four money-path lib trees carry a stricter
      // >=90% BRANCH bar; everything else holds the >=80% global floor.
      // Per-glob blocks do NOT inherit the global thresholds (Vitest
      // semantics), so each block restates every metric. Supporting
      // metrics on the per-path blocks sit at 85 — below the current
      // measured floor (bookings functions ~85.7%) with enough headroom
      // that the gate is meaningful without being brittle.
      thresholds: {
        // Global floor — applies to every included file in aggregate.
        branches: 80,
        lines: 80,
        functions: 80,
        statements: 80,

        // Money-path libs: stricter >=90% branch coverage.
        'lib/payments/**': {
          branches: 90,
          lines: 85,
          functions: 85,
          statements: 85,
        },
        'lib/bookings/**': {
          branches: 90,
          lines: 85,
          functions: 85,
          statements: 85,
        },
        'lib/vendor/**': {
          branches: 90,
          lines: 85,
          functions: 85,
          statements: 85,
        },
        'lib/kyc/**': {
          branches: 90,
          lines: 85,
          functions: 85,
          statements: 85,
        },
      },
      include: ['db/**/*.ts', 'lib/**/*.ts'],
      exclude: [
        '**/*.test.ts',
        '**/*.test.tsx',
        '**/index.ts',
        'db/migrations/**',
        // Schema files are declarative — column shape, CHECK constraints,
        // FKs. Their *behavior* is exercised by the pglite integration
        // tests in db/schema/*.test.ts; the .ts files themselves only
        // export type aliases that don't show up as covered.
        'db/schema/**',
        // Seed script: developer tooling, not production logic. It wires
        // demo fixtures and is exercised manually via `pnpm db:seed`, not
        // by the unit suite. Including it would gate the money path on
        // covering fixture-construction branches.
        'db/seed.ts',
        // Pusher + Sentry are thin SDK init wrappers. M3 (real-time
        // chat) and Sentry-backed error paths get covered when the
        // calling feature lands.
        'lib/pusher/**',
        'lib/sentry/**',
        // Redis / R2 / Resend factories: the dev-stub path is tested,
        // but the real-client path needs SDK init under live creds,
        // which integration tests in M2 exercise. Don't gate M1 on
        // covering the SDK-bound branches without real creds.
        'lib/redis.ts',
        'lib/storage/r2.ts',
        'lib/email/resend.ts',
        // better-auth browser client: a thin SDK init wrapper with no
        // branching logic of our own; covered implicitly when auth UI
        // flows land.
        'lib/auth/client.ts',
        // next-intl request config + image URL helper: thin framework
        // glue with no domain logic to gate on.
        'lib/i18n/request.ts',
        'lib/images.ts',
        // Notifications + home-page queries are deferred feature surfaces
        // (M3 messaging / home redesign). Their Server Actions and query
        // loaders are stubbed/untested until those milestones land; gating
        // the money path on them would be a false signal. Re-include each
        // file as its owning feature ships and earns real test coverage.
        'lib/home/queries.ts',
        'lib/notifications/**',
      ],
    },
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, '.'),
    },
  },
})
