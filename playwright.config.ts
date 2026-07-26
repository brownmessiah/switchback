import { defineConfig, devices } from '@playwright/test'
import { readFileSync } from 'node:fs'
import path from 'node:path'

const AUTH_DIR = path.resolve(__dirname, 'tests/e2e/.auth')

/**
 * The E2E database URL the webServer MUST run against (harness-bifurcation
 * fix, home-redesign issue 11 finding): global-setup resets/pushes/seeds
 * `outvers_e2e` (derived from .env.local's DATABASE_URL) and injects the
 * .auth sessions THERE — but `pnpm dev` reads .env.local directly, so
 * without this override the app serves a DIFFERENT database and every
 * injected session is invalid. Derivation mirrors
 * tests/e2e/helpers/config.ts `e2eDbUrl()`.
 *
 * `dbName` is parameterised (launch-readiness 04) so the SAME derivation
 * also produces the pre-launch webServer's DATABASE_URL
 * (`outvers_e2e_prelaunch`, mirrors `e2ePrelaunchDbUrl()`).
 */
function e2eWebServerDatabaseUrl(dbName: string): string | undefined {
  if (process.env.DATABASE_URL) {
    return process.env.DATABASE_URL.replace(/\/[^/?]+(\?|$)/, `/${dbName}$1`)
  }
  try {
    const envFile = readFileSync(path.resolve(__dirname, '.env.local'), 'utf-8')
    const line = envFile
      .split('\n')
      .map((l) => l.trim())
      .find((l) => l.startsWith('DATABASE_URL='))
    if (!line) return undefined
    return line
      .slice('DATABASE_URL='.length)
      .replace(/\/[^/?]+(\?|$)/, `/${dbName}$1`)
  } catch {
    return undefined
  }
}

const E2E_DATABASE_URL = e2eWebServerDatabaseUrl('outvers_e2e')
// launch-readiness/04: SECOND, isolated database the `prelaunch*` projects'
// webServer runs against — see tests/e2e/helpers/prelaunch-db-setup.ts for
// why this cannot share `outvers_e2e` with every other project.
const E2E_PRELAUNCH_DATABASE_URL = e2eWebServerDatabaseUrl('outvers_e2e_prelaunch')

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
    : [
        {
          name: 'primary',
          // `pnpm dev` (NOT a prebuilt server): the suite relies on dev/test-only
          // simulation hooks (?simulateAvailabilityError, the Razorpay checkout
          // mock, payout-provisioning hooks) that are intentionally absent from a
          // production build, so it must run against the dev server.
          command: 'pnpm dev',
          // The app under test must use the SAME DB global-setup seeds +
          // injects sessions into (outvers_e2e) — .env.local points at the
          // dev DB. Merged over process.env by Playwright.
          env: E2E_DATABASE_URL ? { DATABASE_URL: E2E_DATABASE_URL } : {},
          // Readiness check on the DB-INDEPENDENT shallow healthz (process-up, no
          // SELECT) — NOT the home page. The home page 500s until global-setup
          // creates+seeds outvers_e2e, but Playwright awaits the webServer BEFORE
          // running global-setup; checking the home page deadlocks (home needs the
          // DB ↔ DB created after the webServer is ready). Shallow healthz breaks it.
          url: 'http://localhost:3000/api/healthz?shallow',
          // Never reuse a stale server: it may be bound to the WRONG database
          // (.env.local's dev DB) — precisely the bifurcation this fixes.
          reuseExistingServer: false,
          timeout: 120_000,
        },
        {
          name: 'prelaunch',
          // launch-readiness/04: a SECOND `next dev` instance, same repo, same
          // command — only PORT/DATABASE_URL/NEXT_DIST_DIR differ. This is what
          // lets the `prelaunch*` projects assert the pre-launch home
          // composition against a database with zero Experiences, without
          // truncating (and thereby racing) the shared `outvers_e2e` every
          // other, fullyParallel project depends on.
          command: 'pnpm dev',
          env: {
            ...(E2E_PRELAUNCH_DATABASE_URL ? { DATABASE_URL: E2E_PRELAUNCH_DATABASE_URL } : {}),
            PORT: '3100',
            // Turbopack's dev cache lives under `<distDir>/dev` — a private
            // distDir keeps this instance's build cache from racing (and
            // potentially corrupting) the primary instance's `.next/dev`.
            NEXT_DIST_DIR: '.next-prelaunch',
          },
          // Same shallow/DB-independent reasoning as the primary entry above:
          // the home page 500s until resetPrelaunchDatabase() has run, and
          // Playwright awaits every webServer BEFORE global-setup.
          url: 'http://localhost:3100/api/healthz?shallow',
          reuseExistingServer: false,
          timeout: 120_000,
        },
      ],
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

    // ── i18n: multilingual tests, no auth required ──────────────
    {
      name: 'i18n',
      testDir: './tests/e2e/specs/i18n',
    },

    // ── Responsive (ADR-0018 §8.6): phone (375) + tablet (768) projects.
    //    hasTouch/isMobile emulate a COARSE pointer so the @media(pointer:coarse)
    //    44px touch-target floor (DESIGN.md §8.2) actually activates. Public
    //    surfaces need no auth; the admin set injects the admin session to
    //    exercise the back-office drawer + ResponsiveTable card-collapse. ──
    {
      name: 'responsive-phone-public',
      testDir: './tests/e2e/specs/responsive/public',
      use: { viewport: { width: 375, height: 667 }, hasTouch: true, isMobile: true },
    },
    {
      name: 'responsive-tablet-public',
      testDir: './tests/e2e/specs/responsive/public',
      use: { viewport: { width: 768, height: 1024 }, hasTouch: true, isMobile: true },
    },
    {
      name: 'responsive-phone-admin',
      testDir: './tests/e2e/specs/responsive/admin',
      use: {
        viewport: { width: 375, height: 667 },
        hasTouch: true,
        isMobile: true,
        storageState: path.join(AUTH_DIR, 'admin-demo-storage.json'),
      },
    },
    {
      name: 'responsive-tablet-admin',
      testDir: './tests/e2e/specs/responsive/admin',
      use: {
        viewport: { width: 768, height: 1024 },
        hasTouch: true,
        isMobile: true,
        storageState: path.join(AUTH_DIR, 'admin-demo-storage.json'),
      },
    },

    // ── Pre-launch home (launch-readiness 04): fully isolated — own DB
    //    (outvers_e2e_prelaunch, zero Experiences) + own webServer
    //    (localhost:3100). Never truncates the shared outvers_e2e, so it
    //    cannot race the other (fullyParallel, state='live') projects above.
    //    Phone/tablet variants re-run the same spec dir at those viewports,
    //    mirroring the responsive-{phone,tablet}-public pattern — including
    //    re-running the DevTools fixture's axe pass at each size. ──
    {
      name: 'prelaunch',
      testDir: './tests/e2e/specs/prelaunch',
      use: { baseURL: 'http://localhost:3100' },
    },
    {
      name: 'prelaunch-phone',
      testDir: './tests/e2e/specs/prelaunch',
      use: {
        baseURL: 'http://localhost:3100',
        viewport: { width: 390, height: 844 },
        hasTouch: true,
        isMobile: true,
      },
    },
    {
      name: 'prelaunch-tablet',
      testDir: './tests/e2e/specs/prelaunch',
      use: {
        baseURL: 'http://localhost:3100',
        viewport: { width: 820, height: 1180 },
        hasTouch: true,
        isMobile: true,
      },
    },
  ],
})
