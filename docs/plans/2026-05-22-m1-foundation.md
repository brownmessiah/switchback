# M1 — Foundation Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to implement this plan task-by-task. TDD is mandatory — invoke `superpowers:test-driven-development` at the start of every task. Invoke `superpowers:verification-before-completion` before every commit.

**Goal:** Build the Foundation milestone for the Switchback rebuild — Next.js 15 + Drizzle + Postgres + better-auth + service wiring + one green Playwright smoke test in CI. No domain features ship in M1; this milestone exists so M2 (money path) starts on solid floor.

**Architecture:** Next.js 15 App Router with TypeScript and Tailwind v4. Drizzle ORM over Neon Postgres (ap-south-1 Mumbai). better-auth handles identity (Google OAuth + custom MSG91 phone provider). Vercel deploys with Sentry + PostHog observability. Cloudflare R2 for object storage. Upstash Redis for rate limiting / idempotency keys. Vitest + Playwright for tests; GitHub Actions for CI.

**Tech Stack:** Next.js 15 · TypeScript 5.5 · Tailwind v4 · shadcn/ui · Drizzle ORM · postgres-js · better-auth · MSG91 · Razorpay · Vitest · Playwright

**Domain language:** Use the terms in `CONTEXT.md` *verbatim*. The schema names below match the canonical names — do not synonymise (no "user_kind" instead of "role", no "activity" instead of "Experience", etc.).

**Reference ADRs:**
- ADR-0001 Partial payment capture model
- ADR-0002 RNPL deferred but reserved in schema
- ADR-0003 Booking completion state machine
- ADR-0004 Two-balance wallet model
- ADR-0005 Cancellation policy presets
- ADR-0006 User role model and multi-role support
- ADR-0007 Vendor verification tiers
- ADR-0008 Commission resolution and combo Experiences
- ADR-0009 TripGroup model
- ADR-0010 AI feature guardrails
- ADR-0011 Availability, pricing, permits
- ADR-0012 Multi-locale strategy
- ADR-0013 SEO and URL architecture
- ADR-0014 Channel manager ingestion
- ADR-0015 SOS and safety stack
- ADR-0016 Payouts, GST, TDS

---

## TDD discipline

Every task below follows red → green → refactor → commit:

1. **Red** — write the failing test first; run it; confirm it fails
2. **Green** — write the minimal implementation to make the test pass; run it; confirm it passes
3. **Refactor** — clean up, leaving tests green
4. **Verify coverage** — `pnpm vitest run --coverage` — ensure the file under test ≥ 80% line coverage
5. **Commit** — single commit per task with conventional-commit message
6. **Pre-commit** — invoke `superpowers:verification-before-completion` (run lint + type + tests one final time)

Skip TDD only for pure-scaffold tasks where there's nothing meaningful to test (e.g. `pnpm create next-app`) — but for those tasks, the smoke test is the proof-of-life.

---

## Task 1: Initialize Next.js 15 scaffold + git repo

**Files:**
- Create: entire scaffold tree (`package.json`, `app/`, `tsconfig.json`, `next.config.ts`, etc.)
- Create: `.gitignore` (Next.js default + `.env.local`, `coverage/`, `playwright-report/`, `.next/`)

**Step 1: git init + first commit of bare docs**

```bash
cd /Users/aishwaryechauhan/Personal/switchback-next
git init
git add CLAUDE.md CONTEXT.md PLAN.md RESEARCH.md TODO_FOR_SHIVAM.md docs/
git commit -m "chore: snapshot planning docs before scaffold"
```

**Step 2: Run Next.js scaffold (non-interactive)**

```bash
pnpm create next-app@latest . --typescript --app --tailwind --eslint --import-alias="@/*" --turbopack --no-src-dir --use-pnpm
```

If the directory non-empty check trips, use `--force` (we already committed the docs so we won't lose them).

**Step 3: Validate scaffold**

```bash
pnpm dev
```

Verify `localhost:3000` returns the default Next.js page. Stop the server.

**Step 4: Commit scaffold**

```bash
git add .
git commit -m "feat: initialize Next.js 15 + Tailwind v4 scaffold"
```

---

## Task 2: Install core dependencies

**Files:**
- Modify: `package.json` (adds deps)

**Step 1: Add runtime deps**

```bash
pnpm add drizzle-orm postgres better-auth @upstash/redis pusher pusher-js meilisearch razorpay openai ai @ai-sdk/openai resend react-email @react-email/components zod next-intl @sentry/nextjs posthog-js posthog-node @aws-sdk/client-s3
```

**Step 2: Add dev deps**

```bash
pnpm add -D drizzle-kit vitest @vitejs/plugin-react @vitest/coverage-v8 @playwright/test @types/node tsx @testing-library/react @testing-library/jest-dom @testing-library/user-event jsdom dotenv-cli
```

**Step 3: Commit**

```bash
git add package.json pnpm-lock.yaml
git commit -m "feat: add core runtime and dev dependencies"
```

---

## Task 3: Wire Vitest config + test scripts

**Files:**
- Create: `vitest.config.ts`
- Create: `tests/setup.ts`
- Modify: `package.json` (add `test`, `test:watch`, `test:coverage`, `typecheck`, `lint`)

**Step 1: Write the failing test (sanity-check Vitest is wired)**

Create `tests/unit/sanity.test.ts`:

```typescript
import { describe, expect, it } from 'vitest'

describe('vitest sanity', () => {
  it('arithmetic still works', () => {
    expect(2 + 2).toBe(4)
  })
})
```

**Step 2: Run — expect failure (no vitest config)**

```bash
pnpm vitest run
```

Expected: error about missing config or pattern.

**Step 3: Write `vitest.config.ts`**

```typescript
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    setupFiles: ['./tests/setup.ts'],
    include: ['tests/unit/**/*.test.ts', 'tests/unit/**/*.test.tsx', 'db/**/*.test.ts', 'lib/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      thresholds: { lines: 80, functions: 80, branches: 75, statements: 80 },
      include: ['db/**/*.ts', 'lib/**/*.ts'],
      exclude: ['**/*.test.ts', '**/index.ts'],
    },
  },
  resolve: { alias: { '@': resolve(__dirname, '.') } },
})
```

Create `tests/setup.ts`:

```typescript
import '@testing-library/jest-dom/vitest'
```

Add scripts to `package.json`:

```json
"test": "vitest run",
"test:watch": "vitest",
"test:coverage": "vitest run --coverage",
"typecheck": "tsc --noEmit",
"lint": "next lint"
```

**Step 4: Run — expect pass**

```bash
pnpm test
```

Expected: 1 test passes.

**Step 5: Commit**

```bash
git add vitest.config.ts tests/ package.json
git commit -m "test: wire vitest with 80% coverage thresholds"
```

---

## Task 4: Wire Playwright config + smoke test

**Files:**
- Create: `playwright.config.ts`
- Create: `tests/e2e/smoke.spec.ts`

**Step 1: Write the failing smoke test**

```typescript
// tests/e2e/smoke.spec.ts
import { expect, test } from '@playwright/test'

test('home page returns 200 and a title', async ({ page }) => {
  const response = await page.goto('/')
  expect(response?.status()).toBe(200)
  await expect(page).toHaveTitle(/.+/)
})
```

**Step 2: Run — expect failure (no playwright config / no installed browsers)**

```bash
pnpm playwright test
```

Expected: failure (no config).

**Step 3: Write `playwright.config.ts`**

```typescript
import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 30_000,
  expect: { timeout: 5_000 },
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: [['html', { open: 'never' }], ['list']],
  use: {
    baseURL: 'http://localhost:3000',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    locale: 'en-IN',
    timezoneId: 'Asia/Kolkata',
  },
  webServer: {
    command: 'pnpm dev',
    url: 'http://localhost:3000',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
})
```

```bash
pnpm playwright install chromium
```

**Step 4: Run — expect pass**

```bash
pnpm playwright test
```

Expected: smoke test passes against the default Next.js scaffold page.

**Step 5: Commit**

```bash
git add playwright.config.ts tests/e2e/
git commit -m "test: add Playwright config and home smoke test"
```

---

## Task 5: Wire environment validation (`lib/env.ts`)

**Files:**
- Create: `lib/env.ts`
- Create: `lib/env.test.ts`
- Create: `.env.example`

**Step 1: Write the failing test**

```typescript
// lib/env.test.ts
import { describe, expect, it, beforeEach } from 'vitest'

describe('env validation', () => {
  beforeEach(() => {
    for (const k of Object.keys(process.env)) {
      if (k.startsWith('TEST_ENV_')) delete process.env[k]
    }
  })

  it('throws when DATABASE_URL is missing', async () => {
    const orig = process.env.DATABASE_URL
    delete process.env.DATABASE_URL
    await expect(import('./env?fresh=missing')).rejects.toThrow(/DATABASE_URL/)
    process.env.DATABASE_URL = orig
  })

  it('exposes a typed env object when all required vars are set', async () => {
    process.env.DATABASE_URL = 'postgres://test:test@localhost:5432/test'
    process.env.BETTER_AUTH_SECRET = 'a'.repeat(32)
    process.env.NEXT_PUBLIC_APP_URL = 'http://localhost:3000'
    const { env } = await import('./env?fresh=ok')
    expect(env.DATABASE_URL).toContain('postgres://')
    expect(env.BETTER_AUTH_SECRET).toHaveLength(32)
  })
})
```

Note: `?fresh=...` is a cachebust pattern — Vitest re-imports the module each time.

**Step 2: Run — expect fail**

```bash
pnpm test lib/env.test.ts
```

**Step 3: Write minimal `lib/env.ts`**

```typescript
import { z } from 'zod'

const schema = z.object({
  // Database
  DATABASE_URL: z.string().url(),
  // Auth
  BETTER_AUTH_SECRET: z.string().min(32),
  // App
  NEXT_PUBLIC_APP_URL: z.string().url(),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  // Optional in M1 — required in M2/M3
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  MSG91_AUTH_KEY: z.string().optional(),
  MSG91_SENDER_ID: z.string().optional(),
  MSG91_OTP_TEMPLATE_ID: z.string().optional(),
  RAZORPAY_KEY_ID: z.string().optional(),
  RAZORPAY_KEY_SECRET: z.string().optional(),
  RAZORPAY_WEBHOOK_SECRET: z.string().optional(),
  OPENAI_API_KEY: z.string().optional(),
  RESEND_API_KEY: z.string().optional(),
  MAPBOX_TOKEN: z.string().optional(),
  MEILISEARCH_HOST: z.string().url().optional(),
  MEILISEARCH_KEY: z.string().optional(),
  PUSHER_APP_ID: z.string().optional(),
  PUSHER_KEY: z.string().optional(),
  PUSHER_SECRET: z.string().optional(),
  PUSHER_CLUSTER: z.string().optional(),
  UPSTASH_REDIS_REST_URL: z.string().url().optional(),
  UPSTASH_REDIS_REST_TOKEN: z.string().optional(),
  SENTRY_DSN: z.string().url().optional(),
  POSTHOG_API_KEY: z.string().optional(),
  R2_ACCESS_KEY_ID: z.string().optional(),
  R2_SECRET_ACCESS_KEY: z.string().optional(),
  R2_BUCKET: z.string().optional(),
  R2_ACCOUNT_ID: z.string().optional(),
})

const parsed = schema.safeParse(process.env)
if (!parsed.success) {
  const formatted = parsed.error.format()
  throw new Error(`Environment validation failed: ${JSON.stringify(formatted, null, 2)}`)
}

export const env = parsed.data
export type Env = z.infer<typeof schema>
```

Create `.env.example` listing every var with a placeholder explanation.

**Step 4: Run — expect pass**

**Step 5: Commit**

```bash
git add lib/env.ts lib/env.test.ts .env.example
git commit -m "feat: add typed env validation with zod"
```

---

## Task 6: Drizzle config + db client + first empty migration

**Files:**
- Create: `drizzle.config.ts`
- Create: `db/client.ts`
- Create: `db/client.test.ts`
- Create: `db/schema/index.ts` (empty barrel)
- Modify: `package.json` (db scripts)

**Step 1: Write the failing test (db client returns a postgres-js handle)**

```typescript
// db/client.test.ts
import { describe, expect, it } from 'vitest'

describe('db client', () => {
  it('exports a Drizzle db handle bound to postgres-js', async () => {
    process.env.DATABASE_URL = 'postgres://test:test@localhost:5432/test'
    const { db } = await import('./client?fresh=1')
    expect(db).toBeDefined()
    expect(typeof (db as any).select).toBe('function')
  })
})
```

**Step 2: Run — fail**

**Step 3: Write `db/client.ts`**

```typescript
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { env } from '@/lib/env'
import * as schema from './schema'

const queryClient = postgres(env.DATABASE_URL, { max: 10, prepare: false })
export const db = drizzle(queryClient, { schema })
export type DB = typeof db
```

`db/schema/index.ts`:

```typescript
// Schema barrel — re-exports every domain schema module.
// Populated in Tasks 7–10.
export {}
```

`drizzle.config.ts`:

```typescript
import { defineConfig } from 'drizzle-kit'
import { config } from 'dotenv'
config({ path: '.env.local' })

export default defineConfig({
  schema: './db/schema/index.ts',
  out: './db/migrations',
  dialect: 'postgresql',
  dbCredentials: { url: process.env.DATABASE_URL! },
  verbose: true,
  strict: true,
})
```

Add scripts:

```json
"db:generate": "drizzle-kit generate",
"db:migrate": "drizzle-kit migrate",
"db:studio": "drizzle-kit studio",
"db:push": "drizzle-kit push"
```

**Step 4: Run test — pass**

**Step 5: Commit**

```bash
git add drizzle.config.ts db/ package.json
git commit -m "feat: add Drizzle ORM config and postgres-js client"
```

---

## Task 7: Schema — users + customer_profiles + vendor_profiles + admin_profiles (ADR-0006, ADR-0007)

> Use `everything-claude-code:postgres-patterns` + `postgres-pro` agent for review.

**Files:**
- Create: `db/schema/users.ts`
- Create: `db/schema/customer-profiles.ts`
- Create: `db/schema/vendor-profiles.ts`
- Create: `db/schema/admin-profiles.ts`
- Create: `db/schema/users.test.ts`
- Modify: `db/schema/index.ts` (export new modules)

**Step 1: Write the failing test** (`db/schema/users.test.ts`)

Cover:
- Insert a User, attach all three profiles, assert the User can be both Customer and Vendor (multi-role per ADR-0006)
- KYC tier transition `phone → identity → business` writes the new value (ADR-0007 — full state-machine enforcement comes in M3; schema only validates the enum here)
- `vendor_profiles.commission_rate` defaults to `20.00` (ADR-0008)
- Cascade: deleting a User deletes attached profiles
- `aadhaar_gender_verified` enum supports `female|male|other|unverified` (ADR-0009)
- `admin_profiles.permissions` is a `text[]` so sub-admin permissions are a subset, not a separate role (ADR-0006)

The test connects to a real Postgres test database (Docker on local dev; ephemeral Neon branch in CI). Use `pglite` (`@electric-sql/pglite`) for in-process testing to avoid Docker dep — add as a dev dep in this task.

**Step 2: Run — fail (tables don't exist)**

**Step 3: Write schemas**

`db/schema/users.ts` (lean — only auth identity, per ADR-0006):

```typescript
import { pgTable, text, timestamp, uuid, boolean } from 'drizzle-orm/pg-core'

// better-auth manages this table; the columns here mirror better-auth's drizzle adapter expectations.
export const users = pgTable('users', {
  id: text('id').primaryKey(),
  email: text('email').unique(),
  emailVerified: boolean('email_verified').default(false).notNull(),
  phone: text('phone').unique(),
  phoneVerified: boolean('phone_verified').default(false).notNull(),
  name: text('name'),
  image: text('image'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
})

export type User = typeof users.$inferSelect
export type NewUser = typeof users.$inferInsert
```

`db/schema/customer-profiles.ts`:

```typescript
import { pgTable, text, timestamp, jsonb, pgEnum } from 'drizzle-orm/pg-core'
import { users } from './users'

export const aadhaarGenderVerifiedEnum = pgEnum('aadhaar_gender_verified', [
  'female', 'male', 'other', 'unverified',
])

export const customerProfiles = pgTable('customer_profiles', {
  userId: text('user_id').primaryKey().references(() => users.id, { onDelete: 'cascade' }),
  wishlist: jsonb('wishlist').default([]).notNull(),
  defaultAddress: jsonb('default_address'),
  preferredLanguage: text('preferred_language').default('en').notNull(),
  aadhaarGenderVerified: aadhaarGenderVerifiedEnum('aadhaar_gender_verified').default('unverified').notNull(),
  trustedContactName: text('trusted_contact_name'),
  trustedContactPhone: text('trusted_contact_phone'),
  trustedContactRelationship: text('trusted_contact_relationship'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
})

export type CustomerProfile = typeof customerProfiles.$inferSelect
```

`db/schema/vendor-profiles.ts`:

```typescript
import { pgTable, text, timestamp, numeric, integer, pgEnum, jsonb } from 'drizzle-orm/pg-core'
import { users } from './users'

export const kycTierEnum = pgEnum('kyc_tier', ['phone', 'identity', 'business'])
export const payoutMethodEnum = pgEnum('payout_method', ['upi', 'bank_account'])

export const vendorProfiles = pgTable('vendor_profiles', {
  userId: text('user_id').primaryKey().references(() => users.id, { onDelete: 'cascade' }),
  businessName: text('business_name').notNull(),
  slug: text('slug').notNull().unique(),
  kycTier: kycTierEnum('kyc_tier').default('phone').notNull(),
  // KYC identifiers — ADR-0007
  pan: text('pan'),
  gstin: text('gstin'),
  udyamId: text('udyam_id'),
  aadhaarVerifiedAt: timestamp('aadhaar_verified_at', { withTimezone: true }),
  videoCallVerifiedAt: timestamp('video_call_verified_at', { withTimezone: true }),
  // Commission — ADR-0008
  commissionRate: numeric('commission_rate', { precision: 5, scale: 2 }).default('20.00').notNull(),
  // Payout — ADR-0016
  payoutMethod: payoutMethodEnum('payout_method'),
  payoutDestination: jsonb('payout_destination'),
  payoutDestinationChangedAt: timestamp('payout_destination_changed_at', { withTimezone: true }),
  manualPayoutsRemaining: integer('manual_payouts_remaining').default(3).notNull(),
  // SLA — ADR-0007
  responseTimeSlaScore: numeric('response_time_sla_score', { precision: 5, scale: 2 }).default('100.00').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
})

export type VendorProfile = typeof vendorProfiles.$inferSelect
```

`db/schema/admin-profiles.ts`:

```typescript
import { pgTable, text, timestamp } from 'drizzle-orm/pg-core'
import { users } from './users'

export const adminProfiles = pgTable('admin_profiles', {
  userId: text('user_id').primaryKey().references(() => users.id, { onDelete: 'cascade' }),
  permissions: text('permissions').array().default([]).notNull(),
  invitedByUserId: text('invited_by_user_id').references(() => users.id),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
})

export type AdminProfile = typeof adminProfiles.$inferSelect
```

Update `db/schema/index.ts`:

```typescript
export * from './users'
export * from './customer-profiles'
export * from './vendor-profiles'
export * from './admin-profiles'
```

**Step 4: Generate migration + apply to test DB**

```bash
pnpm db:generate
```

**Step 5: Run tests — pass**

**Step 6: Refactor** — extract reusable column helpers (`createdAt`, `updatedAt`) into `db/schema/_common.ts` if duplication is starting to feel painful. Keep tests green.

**Step 7: Commit**

```bash
git add db/schema/ db/migrations/
git commit -m "feat(db): add users and per-role profile schemas (ADR-0006)"
```

---

## Task 8: Schema — experiences + availability_slots + region_closures + slug_redirects (ADR-0011, ADR-0013)

> Use `everything-claude-code:postgres-patterns` + `postgres-pro` agent.

**Files:**
- Create: `db/schema/experiences.ts`
- Create: `db/schema/availability-slots.ts`
- Create: `db/schema/region-closures.ts`
- Create: `db/schema/slug-redirects.ts`
- Create: `db/schema/experiences.test.ts`
- Modify: `db/schema/index.ts`

**Step 1: Write failing tests**

Cover:
- Insert an Experience referencing a Vendor; slug uniqueness enforced
- `is_combo = true` with `combo_constituents` populated; check constraint: all referenced Experience IDs belong to the same Vendor (ADR-0008)
- `payment_modes_allowed` includes `full_upfront | partial_pay | reserve_now_pay_later` enum values; RNPL value is stored but the application-layer rejects bookings against it (covered in later tasks — schema only stores)
- `cancellation_preset` enum: `flexible | moderate | strict | custom` (ADR-0005)
- `required_permits` is `text[]`
- `requires_safety_stack` boolean defaults false (ADR-0015)
- Three pricing brackets present: `price_per_person_1_2`, `price_per_person_3_5`, `price_per_person_6_plus` (ADR-0011)
- `availability_slots.capacity_taken` cannot exceed `capacity` — DB-level CHECK constraint
- `region_closures.source` enum (`admin | vendor`) and inclusive date range semantics
- `slug_redirects` unique on `(entity_type, old_slug)`; row written records `retired_at`

**Step 2: Write schemas — fail until tables exist**

`db/schema/experiences.ts` (excerpt — full file follows the same pattern):

```typescript
import {
  pgTable, text, timestamp, numeric, integer, boolean, pgEnum, uuid, check,
} from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'
import { vendorProfiles } from './vendor-profiles'

export const cancellationPresetEnum = pgEnum('cancellation_preset', [
  'flexible', 'moderate', 'strict', 'custom',
])

export const experienceStatusEnum = pgEnum('experience_status', [
  'draft', 'pending_review', 'published', 'paused', 'archived',
])

export const paymentModeEnum = pgEnum('payment_mode', [
  'full_upfront', 'partial_pay', 'reserve_now_pay_later',
])

export const experiences = pgTable('experiences', {
  id: uuid('id').primaryKey().defaultRandom(),
  vendorUserId: text('vendor_user_id').references(() => vendorProfiles.userId, { onDelete: 'restrict' }).notNull(),
  slug: text('slug').notNull().unique(),
  title: text('title').notNull(),
  shortDescription: text('short_description'),
  longDescription: text('long_description'),
  // Combos — ADR-0008
  isCombo: boolean('is_combo').default(false).notNull(),
  comboConstituents: uuid('combo_constituents').array(),
  // Commission — ADR-0008
  commissionRateOverride: numeric('commission_rate_override', { precision: 5, scale: 2 }),
  // Policies — ADR-0005
  cancellationPreset: cancellationPresetEnum('cancellation_preset').notNull(),
  cancellationPolicyText: text('cancellation_policy_text'),  // only for `custom`
  // Payment — ADR-0001, ADR-0002
  paymentModesAllowed: paymentModeEnum('payment_modes_allowed').array().notNull(),
  // Pricing — ADR-0011
  pricePerPerson_1_2: numeric('price_per_person_1_2', { precision: 12, scale: 2 }).notNull(),
  pricePerPerson_3_5: numeric('price_per_person_3_5', { precision: 12, scale: 2 }).notNull(),
  pricePerPerson_6_plus: numeric('price_per_person_6_plus', { precision: 12, scale: 2 }).notNull(),
  // Permits + safety — ADR-0011, ADR-0015
  requiredPermits: text('required_permits').array().default([]).notNull(),
  requiresSafetyStack: boolean('requires_safety_stack').default(false).notNull(),
  // Taxonomy — ADR-0013
  regionSlug: text('region_slug').notNull(),
  activitySlug: text('activity_slug').notNull(),
  // State
  status: experienceStatusEnum('status').default('draft').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, t => ({
  // Combo constraint validated in application layer (cross-row check would need a trigger);
  // schema enforces the column type and a SQL-level check that comboConstituents is non-null when isCombo.
  comboHasConstituents: check(
    'combo_has_constituents',
    sql`(${t.isCombo} = false) OR (array_length(${t.comboConstituents}, 1) >= 2)`,
  ),
}))

export type Experience = typeof experiences.$inferSelect
```

`db/schema/availability-slots.ts`:

```typescript
import { pgTable, text, timestamp, integer, uuid, pgEnum, check, uniqueIndex } from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'
import { experiences } from './experiences'

export const slotStatusEnum = pgEnum('slot_status', ['open', 'sold_out', 'closed'])

export const availabilitySlots = pgTable('availability_slots', {
  id: uuid('id').primaryKey().defaultRandom(),
  experienceId: uuid('experience_id').references(() => experiences.id, { onDelete: 'cascade' }).notNull(),
  startAt: timestamp('start_at', { withTimezone: true }).notNull(),
  endAt: timestamp('end_at', { withTimezone: true }).notNull(),
  capacity: integer('capacity').notNull(),
  capacityTaken: integer('capacity_taken').default(0).notNull(),
  status: slotStatusEnum('status').default('open').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, t => ({
  capacityValid: check('capacity_valid', sql`${t.capacityTaken} >= 0 AND ${t.capacityTaken} <= ${t.capacity}`),
  uniqueSlot: uniqueIndex('unique_slot').on(t.experienceId, t.startAt),
}))

export type AvailabilitySlot = typeof availabilitySlots.$inferSelect
```

`db/schema/region-closures.ts`:

```typescript
import { pgTable, text, timestamp, uuid, pgEnum } from 'drizzle-orm/pg-core'

export const closureSourceEnum = pgEnum('closure_source', ['admin', 'vendor'])

export const regionClosures = pgTable('region_closures', {
  id: uuid('id').primaryKey().defaultRandom(),
  regionSlug: text('region_slug').notNull(),
  startAt: timestamp('start_at', { withTimezone: true }).notNull(),
  endAt: timestamp('end_at', { withTimezone: true }).notNull(),
  reason: text('reason').notNull(),
  source: closureSourceEnum('source').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
})

export type RegionClosure = typeof regionClosures.$inferSelect
```

`db/schema/slug-redirects.ts`:

```typescript
import { pgTable, text, timestamp, uuid, uniqueIndex, pgEnum } from 'drizzle-orm/pg-core'

export const slugEntityTypeEnum = pgEnum('slug_entity_type', ['experience', 'vendor', 'combo'])

export const slugRedirects = pgTable('slug_redirects', {
  id: uuid('id').primaryKey().defaultRandom(),
  entityType: slugEntityTypeEnum('entity_type').notNull(),
  entityId: text('entity_id').notNull(),
  oldSlug: text('old_slug').notNull(),
  retiredAt: timestamp('retired_at', { withTimezone: true }).defaultNow().notNull(),
}, t => ({
  uniquePerType: uniqueIndex('unique_slug_per_entity_type').on(t.entityType, t.oldSlug),
}))

export type SlugRedirect = typeof slugRedirects.$inferSelect
```

**Step 3: Generate migration, apply, run tests — pass**

**Step 4: Refactor** if needed.

**Step 5: Commit**

```bash
git add db/schema/ db/migrations/
git commit -m "feat(db): add experiences, availability_slots, region_closures, slug_redirects (ADRs 0011, 0013)"
```

---

## Task 9: Schema — bookings + payments + commission_tiers + pricing_tiers (ADRs 0001, 0003, 0005, 0008, 0011, 0016)

> **Money path. Highest-stakes schema in M1.** Use `postgres-pro` for review; invoke `everything-claude-code:security-reviewer` after writing.

**Files:**
- Create: `db/schema/bookings.ts`
- Create: `db/schema/payments.ts`
- Create: `db/schema/commission-tiers.ts`
- Create: `db/schema/pricing-tiers.ts`
- Create: `db/schema/bookings.test.ts`
- Modify: `db/schema/index.ts`

**Step 1: Write failing tests** — every invariant from the money-path ADRs:

- State enum is exactly `confirmed | awaiting_completion | completed | disputed | cancelled_by_customer | cancelled_by_vendor | cancelled_post_experience` (ADR-0003)
- Snapshot fields exist and are non-null at insert: `gross_total_snapshot`, `price_per_participant_snapshot`, `pricing_basis_snapshot`, `commission_rate_snapshot`, `commission_basis_snapshot`, `cancellation_preset_snapshot`, `tds_amount_snapshot` (ADRs 0001/0005/0008/0011/0016)
- `payment_mode` enum stores `full_upfront | partial_pay | reserve_now_pay_later` (ADR-0002 stores the value; rejecting RNPL is application-layer)
- `payments.capture_trigger` enum: `booking_create | auto_capture_t_minus_24h | escrow_full_capture | manual_admin | refund_reverse` (ADR-0001)
- `commission_tiers` shape with `applies_to_categories[]`, `applies_to_vendor_ids[]`, `applies_to_experience_ids[]`, `rate_override`, `reason`, `created_by_admin_id`, `created_at` (ADR-0008)
- `pricing_tiers` mirror shape (ADR-0011)
- `trip_group_id` on `bookings` is nullable (ADR-0009)
- Update-after-create on snapshot fields is prevented at the schema layer with a trigger that raises an exception — **defer trigger to M2; tests for M1 only assert the column shape**

`db/schema/bookings.ts` (excerpt):

```typescript
import {
  pgTable, text, timestamp, uuid, integer, numeric, pgEnum,
} from 'drizzle-orm/pg-core'
import { users } from './users'
import { experiences } from './experiences'
import { availabilitySlots } from './availability-slots'

export const bookingStateEnum = pgEnum('booking_state', [
  'confirmed',
  'awaiting_completion',
  'completed',
  'disputed',
  'cancelled_by_customer',
  'cancelled_by_vendor',
  'cancelled_post_experience',
])

export const paymentModeBookingEnum = pgEnum('payment_mode_booking', [
  'full_upfront', 'partial_pay', 'reserve_now_pay_later',
])

export const bookings = pgTable('bookings', {
  id: uuid('id').primaryKey().defaultRandom(),
  customerUserId: text('customer_user_id').references(() => users.id, { onDelete: 'restrict' }).notNull(),
  experienceId: uuid('experience_id').references(() => experiences.id, { onDelete: 'restrict' }).notNull(),
  slotId: uuid('slot_id').references(() => availabilitySlots.id, { onDelete: 'restrict' }).notNull(),
  participantCount: integer('participant_count').notNull(),
  state: bookingStateEnum('state').default('confirmed').notNull(),
  paymentMode: paymentModeBookingEnum('payment_mode').notNull(),
  // ===== Snapshots (LOCKED at create; never recomputed) =====
  grossTotalSnapshot: numeric('gross_total_snapshot', { precision: 14, scale: 2 }).notNull(),
  pricePerParticipantSnapshot: numeric('price_per_participant_snapshot', { precision: 12, scale: 2 }).notNull(),
  pricingBasisSnapshot: text('pricing_basis_snapshot').notNull(),
  commissionRateSnapshot: numeric('commission_rate_snapshot', { precision: 5, scale: 2 }).notNull(),
  commissionBasisSnapshot: text('commission_basis_snapshot').notNull(),
  cancellationPresetSnapshot: text('cancellation_preset_snapshot').notNull(),
  tdsAmountSnapshot: numeric('tds_amount_snapshot', { precision: 14, scale: 2 }).default('0.00').notNull(),
  // Refs
  tripGroupId: uuid('trip_group_id'),  // FK to trip_groups added in later task
  // Timestamps
  confirmedAt: timestamp('confirmed_at', { withTimezone: true }).defaultNow().notNull(),
  completedAt: timestamp('completed_at', { withTimezone: true }),
  autoCompleted: text('auto_completed'),  // 'true' if hit end_at + 24h auto-transition per ADR-0003
  cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
  cancellationReason: text('cancellation_reason'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
})

export type Booking = typeof bookings.$inferSelect
```

`db/schema/payments.ts`:

```typescript
import { pgTable, text, timestamp, uuid, numeric, pgEnum, jsonb } from 'drizzle-orm/pg-core'
import { bookings } from './bookings'

export const captureTriggerEnum = pgEnum('capture_trigger', [
  'booking_create',
  'auto_capture_t_minus_24h',
  'escrow_full_capture',
  'manual_admin',
  'refund_reverse',
])

export const payments = pgTable('payments', {
  id: uuid('id').primaryKey().defaultRandom(),
  bookingId: uuid('booking_id').references(() => bookings.id, { onDelete: 'restrict' }).notNull(),
  razorpayPaymentId: text('razorpay_payment_id').notNull().unique(),
  razorpayOrderId: text('razorpay_order_id'),
  amount: numeric('amount', { precision: 14, scale: 2 }).notNull(),
  captureTrigger: captureTriggerEnum('capture_trigger').notNull(),
  capturedAt: timestamp('captured_at', { withTimezone: true }).defaultNow().notNull(),
  rawWebhookPayload: jsonb('raw_webhook_payload'),
})

export type Payment = typeof payments.$inferSelect
```

`db/schema/commission-tiers.ts` and `db/schema/pricing-tiers.ts` mirror each other with their own enums for `basis_label`:

```typescript
// commission-tiers.ts
import { pgTable, text, timestamp, uuid, numeric } from 'drizzle-orm/pg-core'

export const commissionTiers = pgTable('commission_tiers', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),  // 'festival_diwali_2026', 'combo_default', etc.
  startAt: timestamp('start_at', { withTimezone: true }).notNull(),
  endAt: timestamp('end_at', { withTimezone: true }).notNull(),
  appliesToCategories: text('applies_to_categories').array().default([]).notNull(),
  appliesToVendorIds: text('applies_to_vendor_ids').array().default([]).notNull(),
  appliesToExperienceIds: text('applies_to_experience_ids').array().default([]).notNull(),
  rateOverride: numeric('rate_override', { precision: 5, scale: 2 }).notNull(),
  reason: text('reason').notNull(),
  createdByAdminUserId: text('created_by_admin_user_id').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
})

export type CommissionTier = typeof commissionTiers.$inferSelect
```

```typescript
// pricing-tiers.ts — same shape with `rate_override` semantically meaning `price_per_person_override`
import { pgTable, text, timestamp, uuid, numeric } from 'drizzle-orm/pg-core'

export const pricingTiers = pgTable('pricing_tiers', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  startAt: timestamp('start_at', { withTimezone: true }).notNull(),
  endAt: timestamp('end_at', { withTimezone: true }).notNull(),
  appliesToCategories: text('applies_to_categories').array().default([]).notNull(),
  appliesToVendorIds: text('applies_to_vendor_ids').array().default([]).notNull(),
  appliesToExperienceIds: text('applies_to_experience_ids').array().default([]).notNull(),
  pricePerPersonOverride: numeric('price_per_person_override', { precision: 12, scale: 2 }).notNull(),
  reason: text('reason').notNull(),
  createdByAdminUserId: text('created_by_admin_user_id').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
})

export type PricingTier = typeof pricingTiers.$inferSelect
```

**Step 2: Generate migration. Run tests — pass.**

**Step 3: Invoke `everything-claude-code:security-reviewer` agent** with the schema as input — flag any decimal-precision issues, NOT NULL gaps, missing audit columns, or default values that allow legal violations.

**Step 4: Commit**

```bash
git add db/schema/ db/migrations/
git commit -m "feat(db): add bookings, payments, commission_tiers, pricing_tiers (ADRs 0001/0003/0005/0008/0011/0016)"
```

---

## Task 10: Schema — wallet_balances + audit_logs + ai_generations (ADRs 0004, 0010)

**Files:**
- Create: `db/schema/wallet-balances.ts`
- Create: `db/schema/audit-logs.ts`
- Create: `db/schema/ai-generations.ts`
- Create tests as before
- Modify: `db/schema/index.ts`

**Step 1: Failing tests** — assert:
- `wallet_balances` unique on `(user_id, balance_type)`; `balance_type` enum `switchback_credit | refund_balance` (ADR-0004)
- `audit_logs` shape: `actor_user_id`, `action`, `entity_type`, `entity_id`, `payload jsonb`, `created_at` — immutable from the application layer
- `ai_generations.surface` enum `review_summary | listing_draft | inbox_reply | trip_planner`
- `ai_generations.citation_traces` required (NOT NULL `jsonb` default `'[]'`) so the application layer can enforce the ADR-0010 drop-on-missing-citations rule
- `ai_generations.requested_by_user_id` references `users.id`

**Step 2-3: Write schemas**

```typescript
// wallet-balances.ts — ADR-0004
import { pgTable, text, timestamp, numeric, pgEnum, primaryKey } from 'drizzle-orm/pg-core'
import { users } from './users'

export const walletBalanceTypeEnum = pgEnum('wallet_balance_type', ['switchback_credit', 'refund_balance'])

export const walletBalances = pgTable('wallet_balances', {
  userId: text('user_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),
  balanceType: walletBalanceTypeEnum('balance_type').notNull(),
  amount: numeric('amount', { precision: 14, scale: 2 }).default('0.00').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, t => ({
  pk: primaryKey({ columns: [t.userId, t.balanceType] }),
}))

export type WalletBalance = typeof walletBalances.$inferSelect
```

```typescript
// audit-logs.ts
import { pgTable, text, timestamp, uuid, jsonb, index } from 'drizzle-orm/pg-core'

export const auditLogs = pgTable('audit_logs', {
  id: uuid('id').primaryKey().defaultRandom(),
  actorUserId: text('actor_user_id'),  // null for system actions
  action: text('action').notNull(),
  entityType: text('entity_type').notNull(),
  entityId: text('entity_id').notNull(),
  payload: jsonb('payload').default({}).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, t => ({
  byEntity: index('audit_logs_by_entity').on(t.entityType, t.entityId),
  byActor: index('audit_logs_by_actor').on(t.actorUserId),
  byTime: index('audit_logs_by_time').on(t.createdAt),
}))

export type AuditLog = typeof auditLogs.$inferSelect
```

```typescript
// ai-generations.ts — ADR-0010
import { pgTable, text, timestamp, uuid, jsonb, pgEnum } from 'drizzle-orm/pg-core'
import { users } from './users'

export const aiSurfaceEnum = pgEnum('ai_surface', [
  'review_summary',
  'listing_draft',
  'inbox_reply',
  'trip_planner',
])

export const aiGenerations = pgTable('ai_generations', {
  id: uuid('id').primaryKey().defaultRandom(),
  surface: aiSurfaceEnum('surface').notNull(),
  model: text('model').notNull(),
  modelVersion: text('model_version').notNull(),
  promptTemplateHash: text('prompt_template_hash').notNull(),
  inputFingerprint: text('input_fingerprint').notNull(),
  output: jsonb('output').notNull(),
  retrievalSet: jsonb('retrieval_set').default([]).notNull(),
  citationTraces: jsonb('citation_traces').default([]).notNull(),
  requestedByUserId: text('requested_by_user_id').references(() => users.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
})

export type AiGeneration = typeof aiGenerations.$inferSelect
```

**Step 4: Generate migration, apply, tests pass.**

**Step 5: Commit**

```bash
git add db/schema/ db/migrations/
git commit -m "feat(db): add wallet_balances, audit_logs, ai_generations (ADRs 0004, 0010)"
```

---

## Task 11: better-auth wiring (Drizzle adapter + Google OAuth + MSG91 phone provider)

> **Security-sensitive.** Invoke `everything-claude-code:security-reviewer` after writing. Use `nextjs-developer` agent for the route handler.

**Files:**
- Create: `lib/auth/index.ts`
- Create: `lib/auth/msg91-provider.ts`
- Create: `lib/auth/msg91-provider.test.ts`
- Create: `app/api/auth/[...all]/route.ts`
- Create: `db/schema/auth.ts` (better-auth session + account tables)

**Step 1: Failing test for MSG91 provider** (`msg91-provider.test.ts`):

Mock the MSG91 API; cover:
- `sendOtp(phone)` POSTs to MSG91 with the correct payload shape and returns a request ID
- `verifyOtp(phone, code)` returns `{ success: true, userId? }` on 200
- Invalid OTP returns `{ success: false, reason: 'invalid' }`
- MSG91 5xx is surfaced as `{ success: false, reason: 'upstream_error' }` so the UI can show a friendly retry
- A rate-limit response (HTTP 429) returns `{ success: false, reason: 'rate_limited' }`

**Step 2: Run — fail**

**Step 3: Write `msg91-provider.ts`**

Minimal implementation: a `sendOtp` and `verifyOtp` pair wrapping `fetch` to MSG91's REST API. Templates are referenced via `env.MSG91_OTP_TEMPLATE_ID`; sender via `env.MSG91_SENDER_ID`; auth via `env.MSG91_AUTH_KEY`.

**Step 4: Write `lib/auth/index.ts`** using `better-auth` with the Drizzle adapter, Google OAuth, and a phone strategy that delegates to the MSG91 provider. Use `better-auth`'s `phoneNumber()` plugin if available; if not, build a custom plugin that calls `msg91-provider.sendOtp` on request and `verifyOtp` on submit.

**Step 5: Route handler** at `app/api/auth/[...all]/route.ts`:

```typescript
import { auth } from '@/lib/auth'
import { toNextJsHandler } from 'better-auth/next-js'

export const { GET, POST } = toNextJsHandler(auth)
```

**Step 6: Generate auth tables migration**

```bash
pnpm dlx @better-auth/cli generate
```

(or use the better-auth Drizzle migration tool — `lib/auth/index.ts` will own the table definitions).

**Step 7: Tests pass. Commit.**

```bash
git add lib/auth/ app/api/auth/ db/schema/auth.ts db/migrations/
git commit -m "feat(auth): wire better-auth with Drizzle, Google OAuth, MSG91 phone"
```

---

## Task 12: Service wiring (Redis, R2, Sentry, Pusher, Resend) + `.env.example` polish

**Files:**
- Create: `lib/redis.ts`
- Create: `lib/redis.test.ts`
- Create: `lib/storage/r2.ts`
- Create: `lib/storage/r2.test.ts`
- Create: `lib/sentry/init.ts`
- Create: `lib/pusher/server.ts`, `lib/pusher/client.ts`
- Create: `lib/email/resend.ts`
- Create: `sentry.server.config.ts`, `sentry.client.config.ts`, `sentry.edge.config.ts`
- Modify: `next.config.ts` (wrap with `withSentryConfig`)
- Modify: `.env.example` (final list)

**Step 1-5 per module:** standard TDD loop. The tests are thin — they assert constructors return the right shape and that env validation happens (e.g. `lib/redis.ts` re-throws cleanly when `UPSTASH_REDIS_REST_URL` is missing in production).

**Step 6: Commit** per logical group (don't lump 6 wirings into one commit):

```bash
git commit -m "feat: wire Upstash Redis client"
git commit -m "feat: wire Cloudflare R2 (S3-compatible) client"
git commit -m "feat: wire Sentry for Next.js"
git commit -m "feat: wire Pusher server + client"
git commit -m "feat: wire Resend transactional email"
```

---

## Task 13: README + onboarding + CI green

**Files:**
- Create: `README.md` (overview, prerequisites, quick-start, M1 status)
- Create: `.github/workflows/ci.yml`
- Modify: `package.json` (verify all scripts wired)

**Step 1: Write `.github/workflows/ci.yml`**

Jobs: `lint`, `typecheck`, `unit-test` (with coverage threshold), `e2e-test` (Playwright with `chromium`), all running on `ubuntu-latest`, `pnpm` 9. Cache `~/.pnpm-store`. Upload Playwright report on failure as an artifact.

Use a service container for Postgres OR provision an ephemeral Neon branch via the Neon API (deferred to M2 — for M1, Postgres service container is fine).

**Step 2: README** with:

```markdown
# Switchback

## Quick start
pnpm install
cp .env.example .env.local  # fill in credentials
pnpm db:generate && pnpm db:migrate
pnpm dev

## Tests
pnpm test                    # unit + integration
pnpm test:coverage           # with coverage report
pnpm playwright test         # E2E

## Code map
- app/    Next.js App Router (pages, layouts, routes)
- db/     Drizzle schema + migrations + query helpers
- lib/    Domain logic (auth, payments, AI, etc.)
- docs/   ADRs, plans, agent skills

## Reference
- PLAN.md         — milestone plan
- CONTEXT.md      — domain vocabulary
- docs/adr/       — load-bearing decisions
- docs/plans/     — per-milestone implementation plans
- TODO_FOR_SHIVAM.md — operational items
```

**Step 3: Run the full CI pipeline locally**

```bash
pnpm lint && pnpm typecheck && pnpm test && pnpm playwright test
```

All green = M1 done.

**Step 4: Final commit + verification-before-completion gate**

Invoke `superpowers:verification-before-completion`. If any command fails, fix and re-run.

```bash
git add README.md .github/
git commit -m "ci: add lint/typecheck/test/e2e pipeline + onboarding README"
```

---

## After M1

- Push to GitHub. Create the `switchback/switchback-next` repo if it doesn't exist. Set up the Vercel project linked to the repo.
- Verify the Vercel preview deploys produce a working URL.
- Run `superpowers:finishing-a-development-branch` to decide on integration strategy (likely: merge to `main`, tag `v0.1-foundation`).
- Update `MEMORY.md` with a one-line "M1 complete on YYYY-MM-DD" entry so future sessions can resume.

**Next session:** open `docs/plans/2026-MM-DD-m2-money-path.md` (to be written at start of M2).

---

## Self-check before any commit (every task)

1. ☐ Test was written first and failed before implementation
2. ☐ Test now passes
3. ☐ Coverage ≥ 80% on the module under test
4. ☐ `pnpm typecheck` is green
5. ☐ `pnpm lint` is green
6. ☐ Commit message is conventional and references the ADR(s) it implements
7. ☐ No secrets, no `.env.local`, no `coverage/` artifacts staged
