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
    ],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 75,
        statements: 80,
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
      ],
    },
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, '.'),
    },
  },
})
