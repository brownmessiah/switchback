import { defineConfig, devices } from '@playwright/test'
import path from 'node:path'

const AUTH_DIR = path.resolve(__dirname, 'tests/e2e/.auth')

export default defineConfig({
  globalSetup: process.env.E2E_SKIP_SETUP ? undefined : './tests/e2e/global-setup.ts',
  timeout: 60_000,
  expect: { timeout: 5_000 },
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: [
    ['html', { open: 'never' }],
    ['list'],
  ],
  use: {
    baseURL: 'http://localhost:3000',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    locale: 'en-IN',
    timezoneId: 'Asia/Kolkata',
    ...devices['Desktop Chrome'],
  },
  webServer: process.env.E2E_SKIP_SETUP
    ? undefined
    : {
        command: 'pnpm dev',
        url: 'http://localhost:3000',
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
      },
  projects: [
    // ── Unauthenticated: no storage state ───────────────────────
    {
      name: 'unauthenticated',
      testDir: './tests/e2e/specs/unauthenticated',
    },

    // ── Customer: customer session injected ─────────────────────
    {
      name: 'customer',
      testDir: './tests/e2e/specs/customer',
      use: {
        storageState: path.join(AUTH_DIR, 'customer-storage.json'),
      },
    },

    // ── Vendor: vendor session injected ─────────────────────────
    {
      name: 'vendor',
      testDir: './tests/e2e/specs/vendor',
      use: {
        storageState: path.join(AUTH_DIR, 'vendor-storage.json'),
      },
    },

    // ── Admin: admin session injected ───────────────────────────
    {
      name: 'admin',
      testDir: './tests/e2e/specs/admin',
      use: {
        storageState: path.join(AUTH_DIR, 'admin-storage.json'),
      },
    },

    // ── Cross-surface: admin session, depends on admin ──────────
    {
      name: 'cross-surface',
      testDir: './tests/e2e/specs/cross-surface',
      dependencies: ['admin'],
      use: {
        storageState: path.join(AUTH_DIR, 'admin-storage.json'),
      },
    },
  ],
})
