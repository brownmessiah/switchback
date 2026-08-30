# M2 — Money Path Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to implement this plan task-by-task. TDD is mandatory — invoke `superpowers:test-driven-development` at the start of every task. Invoke `superpowers:verification-before-completion` before every commit. After every money-path commit, dispatch `everything-claude-code:security-reviewer` agent on the change.

**Goal:** Build the end-to-end money path — browse → Experience detail → Booking-create → Razorpay capture → confirmation → Vendor commission realised → Refund / Cancellation / Wallet behaviour — so that real Customers can pay real money for real Experiences with full transactional integrity, snapshot-locked commission/pricing/TDS/GST, idempotent webhooks, and SLA-backed wallet refunds.

**Architecture:** Server Actions back every mutation; one `db.transaction(...)` per money-path commit; commission + pricing resolution chains return value-with-basis-label pairs that snapshot onto the Booking row at create time and are never recomputed. The Booking-create transaction does six things atomically: (1) `SELECT … FOR UPDATE` on the slot, (2) capacity decrement, (3) commission resolution + snapshot, (4) pricing resolution + snapshot, (5) TDS + GST math + snapshot, (6) audit-log write. Razorpay webhooks land in `app/api/webhooks/razorpay/route.ts`, are deduplicated against Upstash Redis with a 14-day TTL, and write payment rows inside their own transaction with the unique-index on `razorpay_payment_id` as the last-line idempotency defence. Refund-policy math is a pure function over `(preset, cancellation_timestamp, booking_total)` with its own Vitest suite — load-bearing logic where a 1-line bug = real rupees lost.

**Tech Stack:** Next.js 16 App Router (Server Actions + Server Components) · Drizzle ORM 0.45 · postgres-js · PGlite (test DB) · Razorpay v2 SDK + raw HMAC signature verification · Upstash Redis (webhook dedup + slug-redirect cache) · Meilisearch v1.x · Vitest + Playwright · Zod 4 schemas at every boundary.

**Domain language:** Use the terms in `CONTEXT.md` *verbatim*. Booking, Advance, Partial pay, Commission, Commission snapshot, Cancellation policy, Inside-policy cancellation, Outside-policy cancellation, Vendor-cancelled Booking, Completion, Dispute, Wallet, Switchback credit, Refund balance, Payout, TDS, Pricing tier, Group-size bracket, Availability slot, Region closure, Required permit, Canonical path, Slug redirect, Activity-city collection.

**Reference ADRs:**
- ADR-0001 Partial payment capture model (25% Advance + 75% T-24h with <48h / >Rs.25K carve-outs)
- ADR-0002 RNPL deferred but reserved in schema (must reject cleanly)
- ADR-0003 Booking completion state machine (confirmed → awaiting_completion → completed | disputed)
- ADR-0004 Two-balance wallet model (Switchback credit + Refund balance, spend order)
- ADR-0005 Cancellation policy presets (Flexible / Moderate / Strict / Custom)
- ADR-0008 Commission resolution chain and Combo Experiences (festival → exp → vendor → platform default)
- ADR-0011 Availability + Pricing + Permits (slot capacity, pricing chain, group-size brackets)
- ADR-0013 SEO + URL architecture (`/{lng}/experience/{slug}` canonical, JSON-LD per page type)
- ADR-0016 Payouts + GST + TDS (T+7 from Completion, 18% IGST on commission, 1% TDS u/s 194-O)

---

## TDD discipline

Every task below follows red → green → refactor → commit:

1. **Red** — write the failing test first; run it; confirm it fails
2. **Green** — write the minimal implementation; run; confirm it passes
3. **Refactor** — clean up, leaving tests green
4. **Verify coverage** — `pnpm test:coverage` — ensure ≥80% line coverage on the file under test (money-path files target 95%+)
5. **Security review** — dispatch `everything-claude-code:security-reviewer` agent on the diff for every money-path commit
6. **Pre-commit** — invoke `superpowers:verification-before-completion` (lint + typecheck + tests one final time)
7. **Commit** — single commit per task with conventional-commit message referencing the ADR(s)

Skip TDD only for pure-config tasks (e.g. adding a Vercel Cron entry) — but for those, the integration test is the proof-of-life.

---

## Phase 0 — Schema gaps deferred from M1

Three items flagged in commit `4c97149` must land before booking-create work begins. They are pure DDL + tests, no behaviour wired yet.

### Task 1: `refund_requests` table (ADR-0004 / ADR-0005)

**Why first:** `payments.refund_reverse` rows have no traceable cause today. Every refund (inside-policy auto, outside-policy approved Dispute, Vendor-cancelled full refund, manual admin) must point to a `refund_requests` row that records the reason, the policy snapshot it was evaluated against, the amount, and the destination (Refund balance vs. original payment method cashout).

**Files:**
- Create: `db/schema/refund-requests.ts`
- Create: `db/schema/refund-requests.test.ts`
- Modify: `db/schema/index.ts` (add export)
- Modify: `db/schema/payments.ts` (add nullable `refund_request_id` FK)
- Create: migration via `pnpm db:generate`

**Step 1: Write the failing test** (`db/schema/refund-requests.test.ts`)

Cover:
- `reason` enum is exactly `inside_policy_cancellation | outside_policy_dispute_resolved | vendor_cancelled | admin_override`
- `destination` enum is `refund_balance | original_payment_method`
- `state` enum is `pending | approved | credited | failed | rejected`
- Snapshotted `cancellation_preset_snapshot` and `policy_window_basis_snapshot` (e.g. `"50%_window"`, `"free_window"`, `"no_refund_window"`) — locked at refund_request create
- `amount` numeric(14,2), CHECK >= 0
- FK to `bookings.id` (RESTRICT) — booking with live refund_requests can't be deleted
- Indexes: `(booking_id)`, `(state)`, `(created_at)`
- `payments.refund_request_id` is nullable; CHECK that `capture_trigger='refund_reverse'` implies `refund_request_id IS NOT NULL`

**Step 2: Run — fail** (`pnpm test db/schema/refund-requests.test.ts`)

**Step 3: Write schema**

```typescript
// db/schema/refund-requests.ts
import { sql } from 'drizzle-orm'
import {
  check, index, numeric, pgEnum, pgTable, text, uuid,
} from 'drizzle-orm/pg-core'

import { timestamps } from './_common'
import { bookings } from './bookings'
import { users } from './users'

export const refundReasonEnum = pgEnum('refund_reason', [
  'inside_policy_cancellation',
  'outside_policy_dispute_resolved',
  'vendor_cancelled',
  'admin_override',
])

export const refundDestinationEnum = pgEnum('refund_destination', [
  'refund_balance',
  'original_payment_method',
])

export const refundRequestStateEnum = pgEnum('refund_request_state', [
  'pending', 'approved', 'credited', 'failed', 'rejected',
])

export const refundRequests = pgTable(
  'refund_requests',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    bookingId: uuid('booking_id')
      .references(() => bookings.id, { onDelete: 'restrict' })
      .notNull(),
    requestedByUserId: text('requested_by_user_id')
      .references(() => users.id, { onDelete: 'restrict' })
      .notNull(),
    reason: refundReasonEnum('reason').notNull(),
    destination: refundDestinationEnum('destination').notNull(),
    state: refundRequestStateEnum('state').default('pending').notNull(),
    amount: numeric('amount', { precision: 14, scale: 2 }).notNull(),
    // Snapshots: lock the policy values that justified this refund
    cancellationPresetSnapshot: text('cancellation_preset_snapshot').notNull(),
    policyWindowBasisSnapshot: text('policy_window_basis_snapshot').notNull(),
    // e.g. 'free_window', '50%_window', 'no_refund_window', 'vendor_cancelled', 'admin_override'
    notes: text('notes'),
    resolvedAt: sql<Date>`null`.as('resolved_at'),
    ...timestamps,
  },
  (t) => [
    check('non_negative_refund_amount', sql`${t.amount} >= 0`),
    index('refund_requests_by_booking').on(t.bookingId),
    index('refund_requests_by_state').on(t.state),
    index('refund_requests_by_time').on(t.createdAt),
  ],
)

export type RefundRequest = typeof refundRequests.$inferSelect
export type NewRefundRequest = typeof refundRequests.$inferInsert
```

Note: the `resolvedAt: sql\`null\``  shortcut above is wrong — use the standard `timestamp('resolved_at', { withTimezone: true })`. Correct in the actual implementation; the test will catch it.

**Step 4: Modify `db/schema/payments.ts`**

Add the nullable FK and the consistency check:

```typescript
// inside payments table columns:
refundRequestId: uuid('refund_request_id')
  .references(() => refundRequests.id, { onDelete: 'restrict' }),

// inside the constraints array (alongside the existing amount_sign_matches_trigger):
check(
  'refund_reverse_requires_request',
  sql`(${t.captureTrigger} <> 'refund_reverse') OR (${t.refundRequestId} IS NOT NULL)`,
),
```

**Step 5: Generate migration + run tests**

```bash
pnpm db:generate
pnpm test
```

**Step 6: Commit**

```bash
git add db/schema/ db/migrations/
git commit -m "feat(db): add refund_requests + payments.refund_request_id (ADR-0004, ADR-0005)"
```

---

### Task 2: `payout_method_snapshot` on bookings (ADR-0016)

**Why:** Vendor payout destination can change between Booking-create and Payout disbursement (T+7 from Completion). The snapshot rule from ADR-0008/0016 demands the payout destination at Booking-create is what gets honoured, not the current value on `vendor_profiles.payout_destination`. M3 payout module cannot ship without this column.

**Files:**
- Modify: `db/schema/bookings.ts` (add columns + check)
- Modify: `db/schema/bookings.test.ts` (or wherever existing booking tests live)
- Create: migration

**Step 1: Failing test** — assert that:
- `payoutMethodSnapshot` is non-null at insert (enum: `upi | bank_account | null` — actually NULL allowed when Vendor hasn't onboarded payouts; treat as enum nullable and reject in app layer)
- `payoutDestinationSnapshot` is `jsonb` (mirrors `vendor_profiles.payout_destination` shape)
- A booking row insert with `payout_method_snapshot='upi'` but null `payout_destination_snapshot` fails the CHECK constraint
- Selecting a known-good booking returns both fields verbatim from what was inserted

**Step 2: Run — fail**

**Step 3: Add columns to `db/schema/bookings.ts`**

```typescript
// import payoutMethodEnum from vendor-profiles
import { payoutMethodEnum } from './vendor-profiles'

// inside bookings table columns, after vendorIsResidentSnapshot:
payoutMethodSnapshot: payoutMethodEnum('payout_method_snapshot'),
payoutDestinationSnapshot: jsonb('payout_destination_snapshot'),

// inside the constraints array:
check(
  'payout_destination_consistency',
  sql`(${t.payoutMethodSnapshot} IS NULL AND ${t.payoutDestinationSnapshot} IS NULL)
   OR (${t.payoutMethodSnapshot} IS NOT NULL AND ${t.payoutDestinationSnapshot} IS NOT NULL)`,
),
```

Update `import` line to add `jsonb`.

**Step 4: Generate migration + run tests**

**Step 5: Commit**

```bash
git add db/schema/bookings.ts db/migrations/
git commit -m "feat(db): snapshot payout method + destination on bookings (ADR-0016)"
```

---

### Task 3: UPDATE-block trigger on `bookings` snapshot columns

**Why:** ADR-0008/0011/0016 say snapshots are "locked at create and never recomputed." The M1 bookings schema relies on application-layer + code-review enforcement. M2 builds the Server Action layer; the trigger is the structural safety net so a future bug, a misguided admin SQL, or a rogue migration cannot silently recompute commission/TDS/GST/preset/pricing snapshots on an existing Booking.

**Files:**
- Create: `db/migrations/<next-number>_bookings_snapshot_lock.sql` (raw SQL — drizzle-kit doesn't auto-generate triggers)
- Create: `db/schema/bookings.lock.test.ts` (asserts UPDATE on snapshot columns raises)

**Step 1: Failing test**

```typescript
// db/schema/bookings.lock.test.ts
import { describe, expect, it, beforeAll, afterAll } from 'vitest'
import { setupTestDb, type TestDB } from '@/tests/helpers/db'
import { eq } from 'drizzle-orm'
// ... seed a vendor, experience, slot, and booking row ...

describe('bookings snapshot UPDATE lock', () => {
  it('rejects UPDATE on commission_rate_snapshot', async () => {
    await expect(
      db.update(bookings)
        .set({ commissionRateSnapshot: '15.00' })
        .where(eq(bookings.id, bookingId)),
    ).rejects.toThrow(/snapshot/i)
  })
  // repeat for: pricePerParticipantSnapshot, pricingBasisSnapshot,
  // commissionBasisSnapshot, cancellationPresetSnapshot,
  // tdsAmountSnapshot, grossTotalSnapshot, gstRateOnCommissionSnapshot,
  // vendorPanSnapshot, vendorIsResidentSnapshot, payoutMethodSnapshot,
  // payoutDestinationSnapshot
  it('allows UPDATE on non-snapshot columns (state, completedAt, etc.)', async () => {
    await expect(
      db.update(bookings)
        .set({ state: 'awaiting_completion' })
        .where(eq(bookings.id, bookingId)),
    ).resolves.toBeDefined()
  })
})
```

**Step 2: Run — fail**

**Step 3: Add custom migration with the trigger**

drizzle-kit's `pnpm db:generate` won't create a function/trigger; add the trigger as a raw SQL migration file under `db/migrations/`. Use the next available number (e.g. `0001_lock_booking_snapshots.sql`).

```sql
-- Snapshot lock per ADRs 0008 / 0011 / 0016. Once a booking row exists,
-- the following columns MUST NOT change. UPDATEs are caught at the
-- database layer as the structural safety net for the snapshot rule.

CREATE OR REPLACE FUNCTION reject_booking_snapshot_update()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.gross_total_snapshot IS DISTINCT FROM OLD.gross_total_snapshot
     OR NEW.price_per_participant_snapshot IS DISTINCT FROM OLD.price_per_participant_snapshot
     OR NEW.pricing_basis_snapshot IS DISTINCT FROM OLD.pricing_basis_snapshot
     OR NEW.commission_rate_snapshot IS DISTINCT FROM OLD.commission_rate_snapshot
     OR NEW.commission_basis_snapshot IS DISTINCT FROM OLD.commission_basis_snapshot
     OR NEW.cancellation_preset_snapshot IS DISTINCT FROM OLD.cancellation_preset_snapshot
     OR NEW.tds_amount_snapshot IS DISTINCT FROM OLD.tds_amount_snapshot
     OR NEW.gst_rate_on_commission_snapshot IS DISTINCT FROM OLD.gst_rate_on_commission_snapshot
     OR NEW.vendor_pan_snapshot IS DISTINCT FROM OLD.vendor_pan_snapshot
     OR NEW.vendor_is_resident_snapshot IS DISTINCT FROM OLD.vendor_is_resident_snapshot
     OR NEW.payout_method_snapshot IS DISTINCT FROM OLD.payout_method_snapshot
     OR NEW.payout_destination_snapshot IS DISTINCT FROM OLD.payout_destination_snapshot
  THEN
    RAISE EXCEPTION 'snapshot columns on bookings are immutable after insert';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER bookings_snapshot_lock
BEFORE UPDATE ON bookings
FOR EACH ROW
EXECUTE FUNCTION reject_booking_snapshot_update();
```

Update `db/migrations/meta/_journal.json` if drizzle-kit requires it (it does — append a new entry). Alternatively, name the file with a non-drizzle prefix and apply via `pglite.exec(...)` in `tests/helpers/db.ts` migration loop — confirm both PGlite and Neon Postgres accept the trigger DDL identically.

**Step 4: Run tests — pass**

**Step 5: Commit**

```bash
git add db/migrations/
git commit -m "feat(db): lock booking snapshot columns via UPDATE trigger (ADRs 0008/0011/0016)"
```

---

## Phase 1 — Booking-create primitives

The load-bearing pure functions and the Booking-create transaction every other M2 feature depends on. Each pure function must have its own Vitest suite hitting ≥95% line coverage — these are the files where a 1-line bug = real rupees.

### Task 4: `lib/payments/refund-policy.ts` — pure refund math

**Why:** Refund-policy math is a pure function of `(preset, cancellation_timestamp, booking_total, start_at)` per ADR-0005. Used by (a) cancellation Server Action, (b) refund-flow auto-credit pipeline, (c) the `/cancellation-policy` content page. Build it before the cancellation UI exists.

**Files:**
- Create: `lib/payments/refund-policy.ts`
- Create: `lib/payments/refund-policy.test.ts`

**Step 1: Failing test** — table-driven covering:
- Flexible preset: free up to T-24h, 50% up to T-2h, 0% after
- Moderate preset: free up to T-72h, 50% up to T-24h, 0% after
- Strict preset: free up to T-14d, 50% up to T-7d, 0% after
- Custom preset: throws (`Error: 'custom presets require admin pre-defined refund table'`) — Custom presets must be resolved through `lib/payments/refund-policy-custom.ts` which we'll skeleton with a TODO in M2
- Vendor-cancelled override: always 100% regardless of preset (the Server Action sets `vendor_cancelled = true`)
- Edge cases: cancellation_timestamp exactly equal to a window boundary (e.g. T-24h on Flexible) — assert which side wins (free window inclusive of boundary)
- Edge cases: cancellation_timestamp after start_at → outside-policy regardless of preset → returns `{ refundAmount: 0, basis: 'outside_policy', routesToDispute: true }`
- Booking total handling: integer rupee math; refund amounts are computed in paise then rounded down to nearest rupee (no half-rupee refunds)

**Step 2: Run — fail**

**Step 3: Implement**

```typescript
// lib/payments/refund-policy.ts
import { z } from 'zod'

const PresetSchema = z.enum(['flexible', 'moderate', 'strict', 'custom'])
export type CancellationPreset = z.infer<typeof PresetSchema>

export type PolicyWindowBasis =
  | 'free_window'
  | '50%_window'
  | 'no_refund_window'
  | 'outside_policy'
  | 'vendor_cancelled'

export interface RefundQuote {
  refundAmountRupees: number
  cancellationFeeRupees: number
  basis: PolicyWindowBasis
  routesToDispute: boolean
}

const FLEX_FREE_HRS = 24
const FLEX_HALF_HRS = 2

const MOD_FREE_HRS = 72
const MOD_HALF_HRS = 24

const STRICT_FREE_HRS = 14 * 24
const STRICT_HALF_HRS = 7 * 24

interface Args {
  preset: CancellationPreset
  startAt: Date
  cancellationAt: Date
  bookingTotalRupees: number
  vendorCancelled?: boolean
}

export function quoteRefund(args: Args): RefundQuote {
  const { preset, startAt, cancellationAt, bookingTotalRupees, vendorCancelled = false } = args

  if (bookingTotalRupees < 0) {
    throw new Error('bookingTotalRupees must be >= 0')
  }
  if (preset === 'custom') {
    throw new Error('custom presets must be resolved via refund-policy-custom.ts (not yet implemented)')
  }
  if (vendorCancelled) {
    return {
      refundAmountRupees: bookingTotalRupees,
      cancellationFeeRupees: 0,
      basis: 'vendor_cancelled',
      routesToDispute: false,
    }
  }
  if (cancellationAt >= startAt) {
    return {
      refundAmountRupees: 0,
      cancellationFeeRupees: bookingTotalRupees,
      basis: 'outside_policy',
      routesToDispute: true,
    }
  }

  const hoursToStart = (startAt.getTime() - cancellationAt.getTime()) / 3_600_000

  const windows: Record<Exclude<CancellationPreset, 'custom'>, { free: number; half: number }> = {
    flexible: { free: FLEX_FREE_HRS, half: FLEX_HALF_HRS },
    moderate: { free: MOD_FREE_HRS, half: MOD_HALF_HRS },
    strict: { free: STRICT_FREE_HRS, half: STRICT_HALF_HRS },
  }
  const { free, half } = windows[preset]

  if (hoursToStart >= free) {
    return {
      refundAmountRupees: bookingTotalRupees,
      cancellationFeeRupees: 0,
      basis: 'free_window',
      routesToDispute: false,
    }
  }
  if (hoursToStart >= half) {
    const refund = Math.floor(bookingTotalRupees / 2)
    return {
      refundAmountRupees: refund,
      cancellationFeeRupees: bookingTotalRupees - refund,
      basis: '50%_window',
      routesToDispute: false,
    }
  }
  return {
    refundAmountRupees: 0,
    cancellationFeeRupees: bookingTotalRupees,
    basis: 'no_refund_window',
    routesToDispute: false,
  }
}
```

**Step 4: Tests pass. Run coverage — `pnpm test:coverage lib/payments/refund-policy.test.ts` — confirm ≥95%.**

**Step 5: Dispatch security-reviewer agent.**

**Step 6: Commit**

```bash
git add lib/payments/refund-policy.ts lib/payments/refund-policy.test.ts
git commit -m "feat(payments): add pure refund-policy quoting (ADR-0005)"
```

---

### Task 5: `lib/payments/commission-resolver.ts` — chain resolver (ADR-0008)

**Files:**
- Create: `lib/payments/commission-resolver.ts`
- Create: `lib/payments/commission-resolver.test.ts`

**Step 1: Failing tests** (integration — uses `setupTestDb` to seed festival/experience/vendor rows):
- Festival tier with empty filters fires for any matching Experience (no scope filter = "all")
- Festival tier with `applies_to_experience_ids: [X]` fires only for Experience X
- Festival tier with `applies_to_vendor_ids: [V]` fires only for Vendor V's Experiences
- Festival tier with `applies_to_categories: ['rafting']` fires only when Experience's `activity_slug` ∈ that set
- Multiple festival tiers matching → most recently created wins (per ADR-0008)
- No festival match → falls through to `experiences.commission_rate_override` if non-null
- Combo Experiences (is_combo=true) have `commission_rate_override = 30` set at create — assert resolver returns 30 with basis `experience_override`
- No experience override → falls through to `vendor_profiles.commission_rate`
- No vendor rate (impossible given NOT NULL + default, but test anyway) → falls through to platform default `20`
- Returned shape: `{ rate: '20.00', basis: 'platform_default' | 'vendor_default' | 'experience_override' | `festival:${name}` }`
- Time-window: festival tier active iff `startAt <= now < endAt`; expired tier ignored

**Step 2: Run — fail**

**Step 3: Implement**

```typescript
// lib/payments/commission-resolver.ts
import { and, gte, lte, or, sql } from 'drizzle-orm'

import type { DB } from '@/db/client'
import { commissionTiers } from '@/db/schema/commission-tiers'
import { experiences } from '@/db/schema/experiences'
import { vendorProfiles } from '@/db/schema/vendor-profiles'

export const PLATFORM_DEFAULT_COMMISSION_RATE = '20.00'

export interface ResolvedCommission {
  rate: string  // numeric(5,2) as string, never lose precision
  basis: string // 'festival:<name>' | 'experience_override' | 'vendor_default' | 'platform_default'
}

export async function resolveCommission(
  db: DB,
  args: { experienceId: string; now?: Date },
): Promise<ResolvedCommission> {
  const now = args.now ?? new Date()
  const [exp] = await db.select().from(experiences).where(eq(experiences.id, args.experienceId)).limit(1)
  if (!exp) throw new Error(`experience ${args.experienceId} not found`)

  // 1. Festival tier — most recently created matching tier wins
  const matchingTiers = await db
    .select()
    .from(commissionTiers)
    .where(
      and(
        lte(commissionTiers.startAt, now),
        sql`${commissionTiers.endAt} > ${now}`,
        or(
          sql`array_length(${commissionTiers.appliesToExperienceIds}, 1) IS NULL`,
          sql`${exp.id} = ANY(${commissionTiers.appliesToExperienceIds})`,
        ),
        or(
          sql`array_length(${commissionTiers.appliesToVendorIds}, 1) IS NULL`,
          sql`${exp.vendorUserId} = ANY(${commissionTiers.appliesToVendorIds})`,
        ),
        or(
          sql`array_length(${commissionTiers.appliesToCategories}, 1) IS NULL`,
          sql`${exp.activitySlug} = ANY(${commissionTiers.appliesToCategories})`,
        ),
      ),
    )
    .orderBy(sql`${commissionTiers.createdAt} DESC`)
    .limit(1)

  if (matchingTiers.length) {
    const tier = matchingTiers[0]
    return { rate: tier.rateOverride, basis: `festival:${tier.name}` }
  }

  // 2. Per-Experience override
  if (exp.commissionRateOverride !== null) {
    return { rate: exp.commissionRateOverride, basis: 'experience_override' }
  }

  // 3. Per-Vendor base rate
  const [vendor] = await db
    .select({ rate: vendorProfiles.commissionRate })
    .from(vendorProfiles)
    .where(eq(vendorProfiles.userId, exp.vendorUserId))
    .limit(1)

  if (vendor && vendor.rate) {
    return { rate: vendor.rate, basis: 'vendor_default' }
  }

  // 4. Platform default
  return { rate: PLATFORM_DEFAULT_COMMISSION_RATE, basis: 'platform_default' }
}
```

(Resolve the missing `eq` import.)

**Step 4: Run, refactor, coverage ≥95%.**

**Step 5: Security review on the agent.**

**Step 6: Commit**

```bash
git add lib/payments/commission-resolver.ts lib/payments/commission-resolver.test.ts
git commit -m "feat(payments): commission resolution chain with festival precedence (ADR-0008)"
```

---

### Task 6: `lib/payments/pricing-resolver.ts` — chain resolver (ADR-0011)

**Files:**
- Create: `lib/payments/pricing-resolver.ts`
- Create: `lib/payments/pricing-resolver.test.ts`

**Step 1: Failing tests** parallel to commission tests, plus:
- Group-size bracket selection: `participantCount` 1-2 → `price_per_person_1_2`, 3-5 → `price_per_person_3_5`, 6+ → `price_per_person_6_plus`
- Slot-specific override (deferred for v1.x — assert no slot override path exists yet; chain skips that layer)
- Returned shape: `{ pricePerParticipant: '2500.00', basis: 'pricing_tier:<name>' | 'experience_bracket:1_2' | 'experience_bracket:3_5' | 'experience_bracket:6_plus' }`

**Step 2-6:** Standard TDD loop. Implementation closely mirrors commission-resolver. Pure functions where pricing-tier query mirrors commission-tier query.

**Step 7: Commit**

```bash
git add lib/payments/pricing-resolver.ts lib/payments/pricing-resolver.test.ts
git commit -m "feat(payments): pricing resolution chain with group-size brackets (ADR-0011)"
```

---

### Task 7: `lib/payments/tds-calculator.ts` + `lib/payments/gst-calculator.ts`

**Why:** TDS u/s 194-O is 1% on gross Booking value for resident-Indian Vendors (legal obligation, audit risk). GST is 18% IGST on Switchback commission regardless of Vendor GSTIN status.

**Files:**
- Create: `lib/payments/tds-calculator.ts`, `lib/payments/tds-calculator.test.ts`
- Create: `lib/payments/gst-calculator.ts`, `lib/payments/gst-calculator.test.ts`

**Step 1: Failing tests**

TDS:
- `quoteTds({ grossRupees, vendorIsResident: true, vendorPan: 'ABCDE1234F' })` → 1% rounded down
- `quoteTds({ grossRupees, vendorIsResident: false, ... })` → 0
- `vendorIsResident=true` AND `vendorPan` missing → throws (`'TDS requires vendor PAN for Form 26Q'`)
- Edge: gross = 0 → 0 TDS, no PAN requirement
- Returned shape: `{ tdsRupees: 100, tdsRatePercent: '1.00', basis: 'section_194o_resident' | 'non_resident_exempt' }`

GST:
- `quoteGstOnCommission({ commissionRupees: 500 })` → `{ gstRupees: 90, gstRatePercent: '18.00', basis: 'igst_18' }`
- Rate is sourced from a constant `GST_RATE_ON_COMMISSION = '18.00'` (single source of truth; reflected in `bookings.gst_rate_on_commission_snapshot` default)

**Step 2-6: Standard TDD loop. Implementation under 50 lines each.**

**Step 7: Commit (one commit per calculator)**

```bash
git add lib/payments/tds-calculator.ts lib/payments/tds-calculator.test.ts
git commit -m "feat(payments): TDS calculator for Section 194-O (ADR-0016)"

git add lib/payments/gst-calculator.ts lib/payments/gst-calculator.test.ts
git commit -m "feat(payments): GST on commission calculator (ADR-0016)"
```

---

### Task 8: `lib/audit/write.ts` — append-only audit log helper

**Why:** Every privileged or money-relevant action writes an `audit_logs` row. Centralising the helper means (a) the write always happens, (b) UPDATEs against audit_logs are never possible from app code, (c) payload shape is type-safe per action.

**Files:**
- Create: `lib/audit/write.ts`
- Create: `lib/audit/write.test.ts`

**Step 1: Failing test**

```typescript
import { describe, expect, it, beforeAll, afterAll } from 'vitest'
import { writeAuditLog } from './write'
import { setupTestDb } from '@/tests/helpers/db'
import { auditLogs } from '@/db/schema'

describe('writeAuditLog', () => {
  it('writes an immutable row with the provided actor/action/entity/payload', async () => {
    await writeAuditLog(db, {
      actorUserId: 'user_123',
      action: 'booking.create',
      entityType: 'booking',
      entityId: 'booking_456',
      payload: { commissionRateSnapshot: '20.00' },
    })
    const rows = await db.select().from(auditLogs)
    expect(rows).toHaveLength(1)
    expect(rows[0].action).toBe('booking.create')
    expect(rows[0].payload).toEqual({ commissionRateSnapshot: '20.00' })
  })

  it('allows null actor for system actions', async () => {
    await writeAuditLog(db, {
      actorUserId: null,
      action: 'booking.auto_complete',
      entityType: 'booking',
      entityId: 'booking_789',
      payload: { autoCompleted: true },
    })
    // assert row written, actorUserId is null
  })
})
```

**Step 2-3: Implement**

```typescript
// lib/audit/write.ts
import type { DB } from '@/db/client'
import { auditLogs } from '@/db/schema'

export interface AuditWriteArgs {
  actorUserId: string | null
  action: string
  entityType: string
  entityId: string
  payload?: Record<string, unknown>
}

export async function writeAuditLog(
  db: DB | Parameters<DB['transaction']>[0] extends (tx: infer T) => unknown ? T : never,
  args: AuditWriteArgs,
): Promise<void> {
  await db.insert(auditLogs).values({
    actorUserId: args.actorUserId,
    action: args.action,
    entityType: args.entityType,
    entityId: args.entityId,
    payload: args.payload ?? {},
  })
}
```

Note: the helper accepts both `db` and the transaction handle (`tx`) so the Booking-create transaction can write the audit row in the same transaction.

**Step 4-6: Standard loop. Commit.**

```bash
git add lib/audit/
git commit -m "feat(audit): centralised audit log write helper"
```

---

### Task 9: `lib/payments/booking-create.ts` — the load-bearing transaction

**THIS IS THE BIGGEST SINGLE TASK IN M2.** Every other M2 feature builds on this Server Action / use-case. Time-box: 1–2 days of TDD. Dispatch `everything-claude-code:security-reviewer` twice — once after the initial implementation, once after the test suite is complete.

**Files:**
- Create: `lib/payments/booking-create.ts`
- Create: `lib/payments/booking-create.test.ts`

**Step 1: Failing tests** — these are the load-bearing invariants. Each is a separate test case (table-driven where possible):

Capacity / concurrency:
- Two simultaneous Booking-create attempts for the same slot — only one succeeds (FOR UPDATE serialises)
- A Booking-create that would push `capacity_taken` past `capacity` fails the slot's CHECK constraint and the transaction rolls back
- Slot status `closed` or `sold_out` rejects the Booking with a clear error code

Snapshot rule:
- After create, all 12 snapshot columns (gross, price-per-participant, pricing basis, commission rate, commission basis, cancellation preset, TDS, GST rate, vendor PAN, vendor is-resident, payout method, payout destination) are populated with the values the resolvers returned
- The Booking row's commission_rate_snapshot matches `resolveCommission(...).rate` for the inputs
- The Booking row's price_per_participant_snapshot matches `resolvePricing(...).pricePerParticipant`
- `gross_total_snapshot = price_per_participant_snapshot × participant_count`
- `tds_amount_snapshot = floor(gross_total_snapshot × 0.01)` for resident vendor with PAN; 0 otherwise
- `gst_rate_on_commission_snapshot = '18.00'` (default applies)
- `payout_method_snapshot` and `payout_destination_snapshot` match vendor's current values at create-time
- A subsequent change to `experiences.commission_rate_override`, `vendor_profiles.commission_rate`, `commission_tiers`, or `pricing_tiers` does NOT change the existing Booking's snapshot

Payment-mode gating (ADR-0001 / ADR-0002):
- Booking with `payment_mode='reserve_now_pay_later'` is rejected at the Server Action with error `RNPL_DEFERRED_TO_V2`
- Booking made <48h before `slot.start_at` with `payment_mode='partial_pay'` requested → returns error or auto-coerces to `full_upfront` (decision: auto-coerce, log to audit_logs as `partial_pay_coerced_under_48h`)
- Booking with `gross_total_snapshot > 25000` and `payment_mode='partial_pay'` → escrow-flavoured: payment_mode stored as `partial_pay` but capture_trigger on payment row is `escrow_full_capture` (100% captured upfront, vendor paid T+7 from completion). Document the carve-out clearly.
- Booking against an Experience whose `payment_modes_allowed` doesn't include the requested mode → rejected

Permit gating (ADR-0011):
- Booking against an Experience with `required_permits[]` non-empty WITHOUT `acknowledged_permits=true` in input → rejected
- Acknowledgement booleans recorded in audit log payload

Trip-group:
- `trip_group_id` is optional; passed through to bookings.tripGroupId
- Booking-create never debits a TripGroup balance — each member books individually (ADR-0009)

Audit:
- A `booking.create` audit_logs row is written in the same transaction as the booking insert
- Payload includes: `experienceId`, `slotId`, `participantCount`, `commissionRateSnapshot`, `commissionBasisSnapshot`, `pricingBasisSnapshot`, `paymentMode`, `effectivePaymentMode`, `tdsRupees`, `gstRupees`
- If the transaction rolls back (e.g. on capacity exhaustion), no audit row remains

State:
- Booking is created with `state='confirmed'` (per ADR-0003 — payment has not actually settled yet, but the row exists to anchor the Razorpay order; payment_captured webhook does NOT change state — see Phase 2)
- `confirmedAt = now()`

Idempotency:
- Calling booking-create with the same `idempotencyKey` (a client-generated UUID stored in Redis with 24h TTL) returns the same Booking ID without creating a new row

**Step 2: Run — fail**

**Step 3: Implement** — outline (full file is ~250 lines):

```typescript
// lib/payments/booking-create.ts
import { and, eq, sql } from 'drizzle-orm'
import { z } from 'zod'

import type { DB } from '@/db/client'
import {
  availabilitySlots,
  bookings,
  experiences,
  vendorProfiles,
} from '@/db/schema'
import { writeAuditLog } from '@/lib/audit/write'
import { getRedis } from '@/lib/redis'

import { resolveCommission } from './commission-resolver'
import { resolvePricing } from './pricing-resolver'
import { quoteTds } from './tds-calculator'
import { GST_RATE_ON_COMMISSION } from './gst-calculator'

const InputSchema = z.object({
  customerUserId: z.string().min(1),
  experienceId: z.string().uuid(),
  slotId: z.string().uuid(),
  participantCount: z.number().int().positive().max(50),
  paymentMode: z.enum(['full_upfront', 'partial_pay', 'reserve_now_pay_later']),
  tripGroupId: z.string().uuid().nullable().optional(),
  acknowledgedPermits: z.boolean().default(false),
  idempotencyKey: z.string().uuid(),
})

export type BookingCreateInput = z.infer<typeof InputSchema>

export class BookingCreateError extends Error {
  constructor(public code: BookingCreateErrorCode, message: string) {
    super(message)
  }
}
export type BookingCreateErrorCode =
  | 'RNPL_DEFERRED_TO_V2'
  | 'PAYMENT_MODE_NOT_ALLOWED'
  | 'PERMITS_NOT_ACKNOWLEDGED'
  | 'SLOT_CLOSED'
  | 'SLOT_SOLD_OUT'
  | 'INSUFFICIENT_CAPACITY'
  | 'EXPERIENCE_NOT_FOUND'
  | 'VENDOR_PAYOUT_NOT_CONFIGURED'

export async function createBooking(
  db: DB,
  input: BookingCreateInput,
): Promise<{ bookingId: string; effectivePaymentMode: 'full_upfront' | 'partial_pay' }> {
  const parsed = InputSchema.parse(input)

  // 1. Idempotency check (outside transaction — Redis lookup)
  const redis = getRedis()
  const cached = await redis.get(`booking-create:${parsed.idempotencyKey}`)
  if (cached && typeof cached === 'string') {
    const [existingId, existingMode] = cached.split('|')
    return { bookingId: existingId, effectivePaymentMode: existingMode as never }
  }

  // 2. Reject RNPL up front (ADR-0002)
  if (parsed.paymentMode === 'reserve_now_pay_later') {
    throw new BookingCreateError('RNPL_DEFERRED_TO_V2', 'RNPL is not available in v1')
  }

  return db.transaction(async (tx) => {
    // 3. SELECT FOR UPDATE on slot — serialises concurrent attempts
    const [slot] = await tx
      .select()
      .from(availabilitySlots)
      .where(eq(availabilitySlots.id, parsed.slotId))
      .for('update')
      .limit(1)

    if (!slot) throw new BookingCreateError('SLOT_CLOSED', 'slot not found')
    if (slot.status === 'closed') throw new BookingCreateError('SLOT_CLOSED', 'slot closed')
    if (slot.status === 'sold_out') throw new BookingCreateError('SLOT_SOLD_OUT', 'slot full')
    if (slot.capacityTaken + parsed.participantCount > slot.capacity) {
      throw new BookingCreateError('INSUFFICIENT_CAPACITY', 'not enough seats')
    }

    // 4. Load experience + verify payment mode allowed + permit acknowledgement
    const [exp] = await tx.select().from(experiences).where(eq(experiences.id, parsed.experienceId)).limit(1)
    if (!exp) throw new BookingCreateError('EXPERIENCE_NOT_FOUND', 'experience not found')
    if (!exp.paymentModesAllowed.includes(parsed.paymentMode)) {
      throw new BookingCreateError('PAYMENT_MODE_NOT_ALLOWED', `mode ${parsed.paymentMode} not allowed`)
    }
    if (exp.requiredPermits.length > 0 && !parsed.acknowledgedPermits) {
      throw new BookingCreateError('PERMITS_NOT_ACKNOWLEDGED', 'must acknowledge permits')
    }

    // 5. Load vendor (for payout snapshot + resident status + PAN)
    const [vendor] = await tx
      .select()
      .from(vendorProfiles)
      .where(eq(vendorProfiles.userId, exp.vendorUserId))
      .limit(1)
    if (!vendor) throw new BookingCreateError('EXPERIENCE_NOT_FOUND', 'vendor not found')

    // 6. Resolve pricing chain (snapshot)
    const pricing = await resolvePricing(tx, {
      experienceId: parsed.experienceId,
      participantCount: parsed.participantCount,
      now: slot.startAt,  // resolve as of slot date (for time-windowed pricing tiers)
    })
    const grossRupees = Number(pricing.pricePerParticipant) * parsed.participantCount

    // 7. Resolve commission chain (snapshot)
    const commission = await resolveCommission(tx, { experienceId: parsed.experienceId })

    // 8. TDS (resident vendor only, requires PAN)
    const vendorIsResident = true // TODO: column on vendor_profiles in v1.x (KYC)
    const tds = quoteTds({ grossRupees, vendorIsResident, vendorPan: vendor.pan ?? null })

    // 9. Determine effective payment mode (the <48h / >Rs.25K carve-outs)
    const hoursToStart = (slot.startAt.getTime() - Date.now()) / 3_600_000
    let effectivePaymentMode = parsed.paymentMode
    let captureTrigger: 'booking_create' | 'escrow_full_capture'
    if (parsed.paymentMode === 'partial_pay' && hoursToStart < 48) {
      effectivePaymentMode = 'full_upfront'
      captureTrigger = 'booking_create'
    } else if (parsed.paymentMode === 'partial_pay' && grossRupees > 25_000) {
      // Escrow-flavoured: still record as partial_pay (per ADR-0001 customer UX),
      // but funds collected upfront and held by Switchback until T+7 from Completion
      effectivePaymentMode = 'partial_pay'
      captureTrigger = 'escrow_full_capture'
    } else {
      captureTrigger = 'booking_create'
    }

    // 10. Capacity decrement
    await tx.update(availabilitySlots)
      .set({
        capacityTaken: slot.capacityTaken + parsed.participantCount,
        status: slot.capacityTaken + parsed.participantCount === slot.capacity ? 'sold_out' : slot.status,
      })
      .where(eq(availabilitySlots.id, parsed.slotId))

    // 11. Insert booking with all snapshots
    const [booking] = await tx.insert(bookings).values({
      customerUserId: parsed.customerUserId,
      experienceId: parsed.experienceId,
      slotId: parsed.slotId,
      participantCount: parsed.participantCount,
      paymentMode: effectivePaymentMode,
      state: 'confirmed',
      grossTotalSnapshot: grossRupees.toFixed(2),
      pricePerParticipantSnapshot: pricing.pricePerParticipant,
      pricingBasisSnapshot: pricing.basis,
      commissionRateSnapshot: commission.rate,
      commissionBasisSnapshot: commission.basis,
      cancellationPresetSnapshot: exp.cancellationPreset,
      tdsAmountSnapshot: tds.tdsRupees.toFixed(2),
      gstRateOnCommissionSnapshot: GST_RATE_ON_COMMISSION,
      vendorPanSnapshot: vendor.pan,
      vendorIsResidentSnapshot: vendorIsResident,
      payoutMethodSnapshot: vendor.payoutMethod,
      payoutDestinationSnapshot: vendor.payoutDestination,
      tripGroupId: parsed.tripGroupId ?? null,
    }).returning({ id: bookings.id })

    // 12. Audit log (same transaction)
    await writeAuditLog(tx, {
      actorUserId: parsed.customerUserId,
      action: 'booking.create',
      entityType: 'booking',
      entityId: booking.id,
      payload: {
        experienceId: parsed.experienceId,
        slotId: parsed.slotId,
        participantCount: parsed.participantCount,
        grossRupees,
        commission,
        pricing,
        tds,
        paymentMode: parsed.paymentMode,
        effectivePaymentMode,
        captureTrigger,
      },
    })

    // 13. Idempotency cache after transaction commits
    await redis.set(
      `booking-create:${parsed.idempotencyKey}`,
      `${booking.id}|${effectivePaymentMode}`,
      { ex: 24 * 60 * 60 },
    )

    return { bookingId: booking.id, effectivePaymentMode }
  })
}
```

**Step 4: Run tests — pass. Coverage ≥95%.**

**Step 5: Dispatch security-reviewer agent.** Address every CRITICAL/HIGH finding before commit.

**Step 6: Commit**

```bash
git add lib/payments/booking-create.ts lib/payments/booking-create.test.ts
git commit -m "feat(payments): booking-create transaction with snapshot rule (ADRs 0001/0002/0003/0005/0008/0011/0016)"
```

---

## Phase 2 — Razorpay integration

### Task 10: `lib/payments/razorpay-client.ts` — thin SDK wrapper

**Files:**
- Create: `lib/payments/razorpay-client.ts`
- Create: `lib/payments/razorpay-client.test.ts`

**Step 1: Failing tests** — mock the Razorpay SDK; cover:
- `createOrder({ amountRupees, currency: 'INR', notes })` returns the Razorpay order ID
- `capturePayment({ paymentId, amountRupees })` succeeds on a 200
- `createRefund({ paymentId, amountRupees, notes })` succeeds and returns refund ID
- 5xx from Razorpay → wrapped error with `code='UPSTREAM_5XX'` + retryable flag
- Bad input → `code='RAZORPAY_BAD_REQUEST'` with the upstream message
- All money values converted to paise before sending (Razorpay's wire format)

**Step 2-6: Standard loop.**

```bash
git add lib/payments/razorpay-client.ts lib/payments/razorpay-client.test.ts
git commit -m "feat(payments): Razorpay SDK wrapper with paise-aware money handling"
```

---

### Task 11: `lib/payments/razorpay-signature.ts` — HMAC verification

**Files:**
- Create: `lib/payments/razorpay-signature.ts`
- Create: `lib/payments/razorpay-signature.test.ts`

**Step 1: Failing tests**:
- `verifyWebhookSignature(body, signature, secret)` returns true on valid HMAC-SHA256
- Returns false on any tampering (body, signature, secret)
- Constant-time comparison (use `crypto.timingSafeEqual`)
- Returns false on missing signature header instead of throwing

**Step 2-6: Standard loop.**

```bash
git add lib/payments/razorpay-signature.ts lib/payments/razorpay-signature.test.ts
git commit -m "feat(payments): Razorpay webhook HMAC-SHA256 signature verification"
```

---

### Task 12: `app/api/webhooks/razorpay/route.ts` — idempotent webhook

**Why:** Razorpay retries webhooks up to 24 times over 24 hours on non-2xx. Idempotency is non-negotiable. Layered defence: (1) Redis dedup on the Razorpay-provided event ID with 14-day TTL, (2) DB unique index on `payments.razorpay_payment_id` as the structural floor, (3) idempotent `INSERT … ON CONFLICT DO NOTHING` pattern.

**Files:**
- Create: `app/api/webhooks/razorpay/route.ts`
- Create: `app/api/webhooks/razorpay/route.test.ts`

**Step 1: Failing tests** (Vitest with mocked Redis + Drizzle):
- Webhook with valid signature + new event ID → 200, payment row written, audit_logs row written
- Webhook with valid signature + duplicate event ID (already in Redis) → 200 fast-path, no DB write, no audit
- Webhook with valid signature + event ID not in Redis but payment row already exists (Redis evicted) → 200, DB INSERT no-ops via ON CONFLICT
- Webhook with invalid signature → 401, no DB write, no audit
- Webhook with valid signature but unknown event type → 200, no DB write (we only handle `payment.captured`, `payment.failed`, `refund.processed` in M2)
- Replay 1000x of the same event → exactly one payment row created (per PLAN.md verification)
- Failed-capture event for partial-pay booking → audit log written + Pusher event fired to vendor inbox + booking state remains `confirmed` (M3 handles state transition; in M2 we just record the failure)

**Step 2-3: Implement**

```typescript
// app/api/webhooks/razorpay/route.ts
import { headers } from 'next/headers'
import { NextResponse } from 'next/server'

import { db } from '@/db/client'
import { auditLogs, bookings, payments } from '@/db/schema'
import { env } from '@/lib/env'
import { getRedis } from '@/lib/redis'
import { verifyWebhookSignature } from '@/lib/payments/razorpay-signature'

export async function POST(req: Request) {
  const bodyText = await req.text()
  const signature = (await headers()).get('x-razorpay-signature') ?? ''
  const secret = env.RAZORPAY_WEBHOOK_SECRET
  if (!secret) {
    return NextResponse.json({ error: 'webhook secret not configured' }, { status: 500 })
  }
  if (!verifyWebhookSignature(bodyText, signature, secret)) {
    return NextResponse.json({ error: 'invalid signature' }, { status: 401 })
  }

  const event = JSON.parse(bodyText) as RazorpayEvent
  const redis = getRedis()
  const dedupKey = `razorpay-event:${event.id}`
  const seen = await redis.get(dedupKey)
  if (seen) return NextResponse.json({ ok: true, deduped: true })

  // Set the dedup key BEFORE the DB work so even concurrent retries are blocked
  await redis.set(dedupKey, '1', { ex: 14 * 24 * 60 * 60 })

  try {
    await db.transaction(async (tx) => {
      switch (event.event) {
        case 'payment.captured':
          await handlePaymentCaptured(tx, event)
          break
        case 'payment.failed':
          await handlePaymentFailed(tx, event)
          break
        case 'refund.processed':
          await handleRefundProcessed(tx, event)
          break
        default:
          // unknown event — ack but don't process
          break
      }
    })
    return NextResponse.json({ ok: true })
  } catch (err) {
    // Roll back Redis dedup ONLY for transient errors — leaving the key in
    // place on hard errors is correct (retrying would just fail again).
    return NextResponse.json({ ok: false, error: 'internal' }, { status: 500 })
  }
}
```

`handlePaymentCaptured` uses Drizzle's `.onConflictDoNothing({ target: payments.razorpayPaymentId })` for the inner-layer idempotency. `payments.bookingId` is sourced from `event.payload.payment.entity.notes.booking_id` which the order creation set.

**Step 4-6: Standard loop. Run a 1000x replay test as a Vitest perf test (not a flaky network test).**

**Step 7: Commit**

```bash
git add app/api/webhooks/razorpay/
git commit -m "feat(webhooks): idempotent Razorpay webhook with Redis dedup (ADR-0001)"
```

---

## Phase 3 — Wallet + Refund flow

### Task 13: `lib/payments/wallet.ts` — spend order + credit + cashout

**Files:**
- Create: `lib/payments/wallet.ts`
- Create: `lib/payments/wallet.test.ts`

**Step 1: Failing tests** (ADR-0004 spend order):
- `applyWalletToCheckout({ userId, grossRupees })` returns `{ switchbackCreditApplied, refundBalanceApplied, razorpayRemainder }` with spend order: Switchback credit → Refund balance → Razorpay charge
- Wallet bucket amounts ≥ gross → razorpayRemainder=0
- Wallet bucket amounts < gross → razorpayRemainder=gross-applied
- `creditRefundBalance({ userId, amount, refundRequestId })` increments `wallet_balances.refund_balance` and writes an `audit_logs` row with source=refund
- `creditSwitchbackBalance({ userId, amount, source })` enforces `source ∈ ['referral', 'promo', 'loyalty']`
- Cashout request: `requestCashout({ userId, amount, originalPaymentId })` creates a refund_request row + Razorpay refund call + audit row
- Negative amounts rejected at boundary

**Step 2-6: Standard loop.**

```bash
git add lib/payments/wallet.ts lib/payments/wallet.test.ts
git commit -m "feat(payments): two-bucket wallet with spend order + audit (ADR-0004)"
```

---

### Task 14: `lib/payments/refund-flow.ts` — inside-policy auto-credit, outside-policy routing

**Files:**
- Create: `lib/payments/refund-flow.ts`
- Create: `lib/payments/refund-flow.test.ts`

**Step 1: Failing tests**:
- Inside-policy cancellation (`Flexible` preset, T-25h on a T-24h flexible window) → creates a `refund_requests` row with `state='credited'`, increments `refund_balance`, reverses commission, sets booking.state='cancelled_by_customer', all in one transaction
- 50%-window cancellation → refund amount is `floor(gross/2)`, Vendor keeps the other half as cancellation fee, commission charged on the half-Vendor-keeps
- No-refund-window cancellation → still creates a refund_requests row but with `state='rejected'` and `amount=0`; Vendor gets full revenue
- Outside-policy cancellation (cancellation_at > start_at) → routes to Dispute queue: creates an `audit_logs` row with `action='dispute.opened'`, sets booking.state='disputed', no refund credited yet
- Vendor-cancelled override → 100% refund regardless of preset
- `refund_balance` credit triggers (in M2 stub) — Pusher event to customer notifications; real WhatsApp template wired in M3

**Step 2-3: Implement** — orchestrates `quoteRefund` from Task 4 + `creditRefundBalance` from Task 13 + `db.transaction(...)`.

**Step 4-6: Standard loop.**

```bash
git add lib/payments/refund-flow.ts lib/payments/refund-flow.test.ts
git commit -m "feat(payments): refund flow with inside/outside-policy branches (ADRs 0004, 0005)"
```

---

### Task 15: Cancellation Server Action wiring

**Files:**
- Create: `app/(app)/bookings/[id]/cancel/actions.ts` (Server Action)
- Create: `app/(app)/bookings/[id]/cancel/actions.test.ts`

**Step 1: Failing tests**:
- Authenticated customer cancels their own booking → calls `processRefund(...)` → success
- Customer attempts to cancel another customer's booking → 403
- Cancelling an already-cancelled booking → idempotent (no double-credit)
- Cancelling a booking past `start_at` → routes to Dispute

**Step 2-6: Standard loop.**

```bash
git add 'app/(app)/bookings/[id]/cancel/'
git commit -m "feat(bookings): cancellation Server Action wired to refund-flow"
```

---

## Phase 4 — Partial-pay auto-capture

### Task 16: T-24h auto-capture cron job

**Files:**
- Create: `app/api/cron/partial-pay-autocapture/route.ts` (Vercel Cron-invoked)
- Create: `app/api/cron/partial-pay-autocapture/route.test.ts`
- Modify: `vercel.json` (add cron schedule — runs every 15 minutes)

**Step 1: Failing tests**:
- Job picks up bookings with `paymentMode='partial_pay'`, `state='confirmed'`, and `slot.startAt - now() between 23.5h and 24.5h` window
- For each, calls `razorpay-client.capturePayment(...)` with the 75% remaining amount
- On success: writes payment row with `captureTrigger='auto_capture_t_minus_24h'` + audit row
- On failure: retries 3 times with exponential backoff, then writes audit row `partial_pay_autocapture_failed` + sets booking state to `awaiting_completion` with cancellation_reason='partial_pay_autocapture_failed' + Pusher event to vendor + customer
- Run twice in the same window: idempotency via `(booking_id, capture_trigger)` partial unique on payments → second run is a no-op
- Authentication: Vercel Cron passes a header; reject requests without it (`vercel-cron`)

**Step 2-6: Standard loop. Add the Vercel Cron entry:**

```json
// vercel.json (snippet)
{
  "crons": [
    { "path": "/api/cron/partial-pay-autocapture", "schedule": "*/15 * * * *" }
  ]
}
```

**Step 7: Commit**

```bash
git add app/api/cron/partial-pay-autocapture/ vercel.json
git commit -m "feat(payments): T-24h partial-pay auto-capture job (ADR-0001)"
```

---

### Task 17: Idempotency partial unique index on `(booking_id, capture_trigger)` for auto-capture

**Why:** prevent two auto-capture rows for the same booking even if the cron job runs twice in the same 15-minute window.

**Files:**
- Create: migration adding partial unique index

```sql
CREATE UNIQUE INDEX payments_one_autocapture_per_booking
ON payments (booking_id)
WHERE capture_trigger = 'auto_capture_t_minus_24h';
```

**Step 1-6: Standard loop.**

```bash
git add db/migrations/
git commit -m "feat(db): partial unique index for one auto-capture per booking"
```

---

## Phase 5 — Browse / Detail / Checkout UI

Independent of Phase 6 (Meilisearch) — uses direct PG queries for the first cut. Meilisearch swaps in for the search route once available.

### Task 18: Activity-city collection page (`/{lng}/adventure/{activity}-in-{city}`)

> Use `nextjs-developer` agent. Use `everything-claude-code:frontend-patterns` skill.

**Files:**
- Create: `app/[lng]/adventure/[slug]/page.tsx` (slug matches `<activity>-in-<city>` pattern)
- Create: `app/[lng]/adventure/[slug]/page.test.ts`
- Create: `lib/seo/schemas/item-list.ts` (JSON-LD)
- Create: `lib/seo/schemas/breadcrumb-list.ts`
- Create: `lib/seo/schemas/faq-page.ts`
- Create: `lib/regions/registry.ts` (controlled vocabulary per ADR-0013)
- Create: `lib/activities/registry.ts`

**Step 1: Failing test** (Vitest renders the page Server Component output):
- Loads top N Experiences for `(activity_slug, region_slug)` by published status + response-time SLA
- Renders `<ItemList>` JSON-LD with one Product per Experience
- Renders `<BreadcrumbList>` JSON-LD
- Renders `<FAQPage>` JSON-LD if FAQ content exists
- 404 if `(activity, city)` combination not in registry
- Streams above-the-fold synchronously, product cards in `<Suspense>`
- `<link rel="canonical" href="...">` points to itself (collection page is canonical for the listing query)

**Step 2-6: Standard loop.**

**Step 7: Commit** (one for registries, one for schemas, one for the route)

```bash
git add lib/regions/ lib/activities/
git commit -m "feat(seo): region + activity registries"

git add lib/seo/schemas/
git commit -m "feat(seo): JSON-LD schema generators (ItemList, BreadcrumbList, FAQPage)"

git add 'app/[lng]/adventure/'
git commit -m "feat(seo): activity-city collection page with JSON-LD (ADR-0013)"
```

---

### Task 19: Experience detail page (`/{lng}/experience/{slug}`) with JSON-LD

**Files:**
- Create: `app/[lng]/experience/[slug]/page.tsx`
- Create: `app/[lng]/experience/[slug]/page.test.ts`
- Create: `lib/seo/schemas/product.ts`
- Create: `lib/seo/schemas/aggregate-rating.ts`
- Create: `lib/seo/schemas/review.ts`

**Step 1: Failing test** (per ADR-0013):
- Renders `Product` JSON-LD with offer prices per group-size bracket
- Renders `AggregateRating` if reviews exist
- Renders 5 latest `Review` JSON-LDs
- Renders `FAQPage` from `experiences.faq` (deferred — empty in M2)
- Renders `BreadcrumbList` Home > Destinations > {city} > {experience}
- `<link rel="canonical" href="/{lng}/experience/{slug}">`
- 301-redirects from `slug_redirects.oldSlug` lookups (cached in Redis 24h)
- Permit panel renders when `required_permits[]` non-empty; mandatory acknowledgement checkbox

**Step 2-6: Standard loop.**

```bash
git add lib/seo/schemas/
git commit -m "feat(seo): Product / AggregateRating / Review JSON-LD"

git add 'app/[lng]/experience/'
git commit -m "feat(seo): Experience detail page with canonical + redirects (ADR-0013)"
```

---

### Task 20: Checkout Server Action + Razorpay Checkout integration

**Files:**
- Create: `app/(app)/checkout/[bookingId]/page.tsx`
- Create: `app/(app)/checkout/actions.ts` (Server Action that creates the Booking + Razorpay Order)
- Create: `app/(app)/checkout/actions.test.ts`
- Create: `components/checkout/razorpay-button.tsx` (Client Component using Razorpay's Checkout.js)

**Step 1: Failing test**:
- Server Action `initiateCheckout(input)` calls `createBooking(...)` to get a Booking ID, then `razorpay.createOrder(...)` for the gross amount (or 25% if partial_pay), then returns `{ bookingId, razorpayOrderId, amountRupees, keyId }`
- The client-side Razorpay Checkout button receives `{ razorpayOrderId, amountRupees, keyId, customer }` and renders the Razorpay modal
- On success callback, posts to `/api/checkout/confirm` which validates the payment ID against the order ID (defence-in-depth before the webhook arrives) and updates UI to "confirmed"
- Permit gating: if `acknowledged_permits=false` → reject in initiateCheckout

**Step 2-6: Standard loop. Mock Razorpay Checkout.js in tests via msw or vitest-mock-extended.**

```bash
git add 'app/(app)/checkout/' components/checkout/
git commit -m "feat(checkout): Razorpay Checkout integration with Server Action initiation"
```

---

### Task 21: Booking confirmation page + transactional email (Resend) + WhatsApp template stub

**Files:**
- Create: `app/(app)/bookings/[id]/page.tsx`
- Create: `app/(app)/bookings/[id]/page.test.ts`
- Create: `emails/booking-confirmation.tsx` (React Email template)
- Create: `lib/whatsapp/templates.ts` (M3 will wire MSG91; M2 records intended-send events to audit log)

**Step 1: Failing test**:
- Confirmation page renders booking details + Cancellation policy + permit panel + manage-booking links
- After booking-create transaction commits, a `booking.confirmation.send` audit log event is written (the actual Resend + MSG91 send happens via a queue worker; in M2 we just record intent)
- React Email template renders with all required fields

**Step 2-6: Standard loop.**

```bash
git add 'app/(app)/bookings/' emails/ lib/whatsapp/
git commit -m "feat(bookings): confirmation page + email template + WhatsApp send-intent"
```

---

## Phase 6 — Meilisearch indexer + faceted search

> Dispatch in parallel with Phase 5 once Phase 1 is stable. Independent of the booking flow.

### Task 22: Meilisearch client + indexer

**Files:**
- Create: `lib/search/meilisearch-client.ts`
- Create: `lib/search/indexer.ts` (mirror `experiences` rows into Meilisearch with the searchable / filterable / sortable schema)
- Create: `lib/search/indexer.test.ts`

**Step 1: Failing tests**:
- `indexExperience(experienceId)` upserts the Experience document into Meilisearch
- Searchable fields: title, short_description, region_slug, activity_slug
- Filterable facets: activity_slug, region_slug, requires_safety_stack, cancellation_preset, requires_permits (computed: required_permits non-empty)
- Sortable: price_per_person_1_2, response_time_sla_score, average_rating
- `unindexExperience(experienceId)` removes the document
- Indexer is called inside an `after()` hook in the publish Server Action, not in the transaction (per `experiences.status` → 'published')

Use the same dev-stub pattern as `lib/redis.ts` — return a no-op stub when `MEILISEARCH_HOST` isn't set so dev workflow works without provisioning Meilisearch.

**Step 2-6: Standard loop.**

```bash
git add lib/search/
git commit -m "feat(search): Meilisearch client + experiences indexer (port from legacy)"
```

---

### Task 23: Search route + faceted UI

**Files:**
- Create: `app/[lng]/search/page.tsx`
- Create: `app/[lng]/search/page.test.ts`

**Step 1: Failing test**:
- Renders search results with `?q=<query>` querystring
- Faceted filter sidebar (activity, region, has-permits, cancellation preset)
- Sort by: price-asc, price-desc, response-time, default-relevance
- Sort/filter URL variants emit `<link rel="canonical">` pointing at the unfiltered URL (ADR-0013)
- Paginated results beyond page 1 are `noindex, follow`

**Step 2-6: Standard loop.**

```bash
git add 'app/[lng]/search/'
git commit -m "feat(search): faceted search route with canonical for sort/filter variants"
```

---

## Phase 7 — E2E verification + M2 sign-off

### Task 24: Playwright E2E happy path

**Files:**
- Modify: `tests/e2e/smoke.spec.ts` → add the M2 paths
- Create: `tests/e2e/money-path.spec.ts`

**Step 1: Failing E2E**:
- Customer registers via MSG91 OTP (use test mode; mock MSG91 via Playwright network interception)
- Customer browses `/en/adventure/rafting-in-rishikesh`, sees Product cards
- Customer opens an Experience detail page
- Customer initiates checkout, the Razorpay test-mode modal renders, completes the test card
- Customer is redirected to `/en/bookings/<id>` showing "confirmed"
- Inspect the DB: the booking has all 12 snapshot columns populated; one `payments` row with `capture_trigger='booking_create'`; one `audit_logs` row for `booking.create`
- Customer initiates cancellation within Flexible's free window → refund_balance increments → audit row written

**Step 2-3: Use Playwright network interception + `@razorpay/test-utils` for deterministic test-mode flows.**

**Step 4-6: Standard loop.**

```bash
git add tests/e2e/
git commit -m "test(e2e): money path happy + cancellation + refund flows"
```

---

### Task 25: M2 verification gate

**Files:**
- Modify: `README.md` ("What's done" updated to M2)
- Create: `docs/plans/m2-verification.md` (verification checklist + results)

**Run all gates in order:**

```bash
pnpm lint
pnpm typecheck
pnpm test:coverage           # ≥80% project-wide; ≥95% on lib/payments/*
pnpm e2e
```

**Verification checklist** (write into `docs/plans/m2-verification.md` with PASS/FAIL):

- [ ] Booking-create transaction is atomic: capacity decrement + booking insert + audit row in one `db.transaction(...)` — rollback test passes
- [ ] All 12 snapshot columns populated; UPDATE trigger raises on any attempt to change them
- [ ] Commission resolver: festival > experience override > vendor default > platform default
- [ ] Pricing resolver: pricing tier > group-size bracket > base
- [ ] Refund-policy pure function: 36 table-driven cases pass
- [ ] Razorpay webhook idempotency: 1000x replay → exactly one payment row
- [ ] Partial-pay auto-capture: cron job picks up T-24h window, captures 75%, writes audit
- [ ] <48h partial-pay coerced to full_upfront
- [ ] >Rs.25K partial-pay → escrow capture_trigger
- [ ] RNPL booking attempt rejected cleanly with `RNPL_DEFERRED_TO_V2`
- [ ] Inside-policy cancellation auto-credits Refund balance + reverses commission
- [ ] Outside-policy cancellation routes to Dispute queue
- [ ] Vendor-cancelled → 100% refund regardless of preset
- [ ] Wallet spend order: Switchback credit → Refund balance → Razorpay remainder
- [ ] Activity-city + Experience detail + JSON-LD validates against schema.org
- [ ] Slug redirects: old slug 301s to canonical with 24h Redis cache
- [ ] Meilisearch indexer fires `after()` publish; facets work
- [ ] E2E browse → book → pay → confirm passes in CI
- [ ] E2E cancel within Flexible window credits refund_balance

**Step 1: Run every gate, capture pass/fail, fix until green.**

**Step 2: Update README.md "What's done" list.**

**Step 3: Update memory:**

Write to `~/.claude/projects/-Users-aishwaryechauhan-Personal-switchback-next/memory/project_m2_complete.md` with:
- Date M2 landed
- Final test count + coverage
- Items deferred to M3 (channel manager seat-block, full WhatsApp templates, Aadhaar tier-2 verification)
- Snapshot of what's tested in the money path

**Step 4: Final commit + tag**

```bash
git add README.md docs/plans/m2-verification.md
git commit -m "docs(m2): M2 money path verification + README update"
git tag v0.2-money-path
```

---

## After M2

- `superpowers:finishing-a-development-branch` to confirm integration strategy.
- Push tag to GitHub. Verify Vercel preview deploy works against a real Neon branch.
- Run `superpowers:requesting-code-review` for a final pass on the money path before M3 begins.
- **Operational items (per TODO_FOR_SHIVAM.md):**
  - Razorpay live activation must complete before M3 verification gates.
  - GSTIN active for Switchback Pvt Ltd verified.
  - TAN active for TDS deduction verified.

**Next session:** open `docs/plans/<date>-m3-trust-and-safety.md` (KYC tiers + WhatsApp + Reviews + SOS).

---

## Self-check before any commit (every task)

1. [ ] Test was written first and failed before implementation
2. [ ] Test now passes
3. [ ] Coverage on the file under test ≥80% (≥95% for `lib/payments/*`)
4. [ ] `pnpm typecheck` is green
5. [ ] `pnpm lint` is green
6. [ ] If money-path: `everything-claude-code:security-reviewer` agent ran on the diff and CRITICAL/HIGH findings addressed
7. [ ] Commit message is conventional and references the ADR(s) it implements
8. [ ] No secrets, no `.env.local`, no `coverage/` artifacts staged

---

## Parallelisation map

Once Phase 1 is stable (Tasks 1–9 done), independent streams can be dispatched in parallel via `superpowers:dispatching-parallel-agents`:

- **Stream A (Razorpay):** Tasks 10 → 11 → 12 → 16/17
- **Stream B (Wallet/Refund):** Tasks 13 → 14 → 15
- **Stream C (SEO routes):** Tasks 18 → 19 → 20 → 21
- **Stream D (Search):** Tasks 22 → 23

Phase 7 (E2E + verification) only fires after all streams converge.
