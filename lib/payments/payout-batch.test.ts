import { and, eq, sql } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { auditLogs } from '@/db/schema/audit-logs'
import { availabilitySlots } from '@/db/schema/availability-slots'
import { bookings } from '@/db/schema/bookings'
import { experiences } from '@/db/schema/experiences'
import { payouts } from '@/db/schema/payouts'
import { users } from '@/db/schema/users'
import { vendorFundAccounts } from '@/db/schema/vendor-fund-accounts'
import { vendorProfiles } from '@/db/schema/vendor-profiles'
import { setupTestDb, type TestDB } from '@/tests/helpers/db'

import type { CreatePayoutInput, CreatePayoutResult } from './razorpayx-client'
import { destinationFingerprint } from './payout-destination'
import { processPayoutBatch } from './payout-batch'

/**
 * Payout Batch cron worker per ADR-0016 (2026-06-18 amendment, D1+D3).
 *
 * Daily 5pm-IST: groups matured, eligible Payouts into Payout Batches keyed on
 * (vendor, destination, batchDay), sums their net, and sends ONE Razorpay X
 * transfer per Batch. Mirrors processPartialPayAutocapture's db-injected shape
 * with a stubbed createPayout (no network).
 *
 * At-most-once is proven by the double-invocation test: running the worker
 * twice produces exactly one payouts row per group, exactly one effective
 * createPayout, and links each member Booking once. The unique index makes the
 * double-INSERT a no-op; the X-Payout-Idempotency header (= payouts.id) makes a
 * double createPayout safe.
 */
describe('processPayoutBatch (ADR-0016)', () => {
  let db: TestDB
  let teardown: () => Promise<void>

  const BATCH_DAY = '2026-06-18'
  const NOW = new Date('2026-06-18T11:30:00.000Z')
  const VPA_A = { vpa: 'vendor-a@upi' }
  const VPA_B = { vpa: 'vendor-b@upi' }
  const FP_A = destinationFingerprint(VPA_A)
  const FP_B = destinationFingerprint(VPA_B)
  // completed 30 days ago → matured under both the T+7 and T+30 windows.
  const LONG_AGO = new Date(NOW.getTime() - 30 * 86_400_000)

  beforeAll(async () => {
    const setup = await setupTestDb()
    db = setup.db
    teardown = setup.teardown

    await db.insert(users).values([
      { id: 'u_v', email: 'v@example.com' },
      { id: 'u_c', email: 'c@example.com' },
    ])
    await db.insert(vendorProfiles).values({
      userId: 'u_v',
      businessName: 'Test Adventures',
      slug: 'test-adventures',
      pan: 'ABCDE1234F',
      commissionRate: '20.00',
      payoutMethod: 'upi',
      payoutDestination: VPA_A,
      manualPayoutsRemaining: 0,
    })
  })

  afterAll(async () => {
    await teardown()
  })

  beforeEach(async () => {
    await db.execute(
      sql`TRUNCATE TABLE audit_logs, payouts, bookings, availability_slots, experiences, vendor_fund_accounts CASCADE`,
    )
  })

  /** A stub createPayout that records every call and returns a deterministic id. */
  function makeStubPayout(): {
    createPayout: (input: CreatePayoutInput) => Promise<CreatePayoutResult>
    calls: CreatePayoutInput[]
  } {
    const calls: CreatePayoutInput[] = []
    let n = 0
    const createPayout = async (input: CreatePayoutInput): Promise<CreatePayoutResult> => {
      calls.push(input)
      n += 1
      return {
        payoutId: `pout_${n}`,
        status: 'processing',
        amountPaise: input.amountRupees * 100,
      }
    }
    return { createPayout, calls }
  }

  async function seedExperience(opts?: { requiredPermits?: string[] }): Promise<string> {
    const [exp] = await db
      .insert(experiences)
      .values({
        vendorUserId: 'u_v',
        slug: `exp-${Math.random().toString(36).slice(2)}`,
        title: 'Rafting Day',
        cancellationPreset: 'flexible',
        paymentModesAllowed: ['full_upfront'],
        pricePerPerson_1_2: '5000.00',
        pricePerPerson_3_5: '4500.00',
        pricePerPerson_6_plus: '4000.00',
        regionSlug: 'rishikesh',
        activitySlug: 'rafting',
        requiredPermits: opts?.requiredPermits ?? [],
      })
      .returning({ id: experiences.id })
    return exp!.id
  }

  /**
   * Seed a completed Booking with a single-day slot (unless multiDay), the
   * payout snapshot fields, and the given payout state. gross 10000 →
   * net 7580 (20% comm, 18% GST, ₹10 TDS, ₹50 TCS).
   */
  async function seedCompletedBooking(args: {
    experienceId: string
    completedAt?: Date | null
    payoutState?: 'pending' | 'approved' | 'rejected' | 'held'
    destination?: unknown
    multiDay?: boolean
    grossRupees?: number
  }): Promise<string> {
    // Each slot needs a distinct start_at (unique per experience). Jitter by a
    // random number of minutes within the same day so multiple Bookings on one
    // experience never collide on the (experience_id, start_at) unique index.
    const jitterMs = Math.floor(Math.random() * 600) * 60_000
    const slotStart = new Date(new Date('2026-05-01T04:00:00.000Z').getTime() + jitterMs)
    const slotEnd = args.multiDay
      ? new Date('2026-05-03T04:00:00.000Z')
      : new Date(slotStart.getTime() + 60 * 60 * 1000)
    const [slot] = await db
      .insert(availabilitySlots)
      .values({ experienceId: args.experienceId, startAt: slotStart, endAt: slotEnd, capacity: 8 })
      .returning({ id: availabilitySlots.id })
    const gross = args.grossRupees ?? 10000
    const [booking] = await db
      .insert(bookings)
      .values({
        customerUserId: 'u_c',
        experienceId: args.experienceId,
        slotId: slot!.id,
        participantCount: 2,
        paymentMode: 'full_upfront',
        state: 'completed',
        completedAt: args.completedAt === undefined ? LONG_AGO : args.completedAt,
        grossTotalSnapshot: gross.toFixed(2),
        pricePerParticipantSnapshot: (gross / 2).toFixed(2),
        pricingBasisSnapshot: 'experience_bracket:1_2',
        commissionRateSnapshot: '20.00',
        commissionBasisSnapshot: 'vendor_default',
        cancellationPresetSnapshot: 'flexible',
        tdsAmountSnapshot: '10.00',
        gstRateOnCommissionSnapshot: '18.00',
        tcsAmountSnapshot: '50.00',
        vendorPanSnapshot: 'ABCDE1234F',
        vendorIsResidentSnapshot: true,
        payoutMethodSnapshot: 'upi',
        payoutDestinationSnapshot: args.destination ?? VPA_A,
        payoutState: args.payoutState ?? 'approved',
      })
      .returning({ id: bookings.id })
    return booking!.id
  }

  /** Provision a cooled-off Fund Account for the given fingerprint. */
  async function provisionFundAccount(fingerprint: string, fundAccountId: string): Promise<void> {
    await db.insert(vendorFundAccounts).values({
      vendorUserId: 'u_v',
      destinationFingerprint: fingerprint,
      razorpayFundAccountId: fundAccountId,
      coolingOffUntil: new Date(NOW.getTime() - 86_400_000),
    })
  }

  it('sends one Razorpay X transfer for a single eligible Batch, links the Booking, persists the row', async () => {
    const expId = await seedExperience()
    const bookingId = await seedCompletedBooking({ experienceId: expId })
    await provisionFundAccount(FP_A, 'fa_A')
    const { createPayout, calls } = makeStubPayout()

    const result = await processPayoutBatch({ db, now: NOW, batchDay: BATCH_DAY, createPayout })

    expect(result.batchesPlanned).toBe(1)
    expect(result.sent).toBe(1)
    expect(result.skippedAdminQueue).toBe(0)
    expect(result.alreadySent).toBe(0)

    // Exactly one transfer for the summed net.
    expect(calls).toHaveLength(1)
    expect(calls[0]!.amountRupees).toBe(7580)
    expect(calls[0]!.mode).toBe('UPI')
    expect(calls[0]!.fundAccountId).toBe('fa_A')

    // One payouts row, processing, with the razorpay id + summed tds/tcs.
    const rows = await db.select().from(payouts)
    expect(rows).toHaveLength(1)
    const row = rows[0]!
    expect(row.status).toBe('processing')
    expect(row.razorpayPayoutId).toBe('pout_1')
    expect(row.amountNetRupees).toBe('7580.00')
    expect(row.tdsTotal).toBe('10.00')
    expect(row.tcsTotal).toBe('50.00')
    expect(row.razorpayFundAccountId).toBe('fa_A')

    // The idempotency key and reference are both the payouts row id.
    expect(calls[0]!.idempotencyKey).toBe(row.id)
    expect(calls[0]!.referenceId).toBe(row.id)

    // The member Booking is linked to the Batch.
    const [linked] = await db
      .select({ payoutBatchId: bookings.payoutBatchId })
      .from(bookings)
      .where(eq(bookings.id, bookingId))
    expect(linked!.payoutBatchId).toBe(row.id)
  })

  it('transfer amount equals the SUMMED member net; deductions are retained, not transferred', async () => {
    const expId = await seedExperience()
    await seedCompletedBooking({ experienceId: expId })
    await seedCompletedBooking({ experienceId: expId })
    await provisionFundAccount(FP_A, 'fa_A')
    const { createPayout, calls } = makeStubPayout()

    await processPayoutBatch({ db, now: NOW, batchDay: BATCH_DAY, createPayout })

    expect(calls).toHaveLength(1)
    // 2 × net 7580 = 15160 — NOT 2 × gross 10000.
    expect(calls[0]!.amountRupees).toBe(15160)
    const [row] = await db.select().from(payouts)
    expect(row!.amountNetRupees).toBe('15160.00')
    expect(row!.tdsTotal).toBe('20.00')
    expect(row!.tcsTotal).toBe('100.00')
  })

  it('splits a vendor with divergent destinations into two Batches → two transfers', async () => {
    const expId = await seedExperience()
    await seedCompletedBooking({ experienceId: expId, destination: VPA_A })
    await seedCompletedBooking({ experienceId: expId, destination: VPA_B })
    await provisionFundAccount(FP_A, 'fa_A')
    await provisionFundAccount(FP_B, 'fa_B')
    const { createPayout, calls } = makeStubPayout()

    const result = await processPayoutBatch({ db, now: NOW, batchDay: BATCH_DAY, createPayout })

    expect(result.batchesPlanned).toBe(2)
    expect(result.sent).toBe(2)
    expect(calls).toHaveLength(2)
    const rows = await db.select().from(payouts)
    expect(rows).toHaveLength(2)
    expect(rows.map((r) => r.razorpayFundAccountId).sort()).toEqual(['fa_A', 'fa_B'])
  })

  describe('admin-queue routing (never dropped, never transferred)', () => {
    it('routes a group with a MISSING fund account to the admin queue', async () => {
      const expId = await seedExperience()
      const bookingId = await seedCompletedBooking({ experienceId: expId })
      // no provisionFundAccount → missing
      const { createPayout, calls } = makeStubPayout()

      const result = await processPayoutBatch({ db, now: NOW, batchDay: BATCH_DAY, createPayout })

      expect(result.batchesPlanned).toBe(1)
      expect(result.sent).toBe(0)
      expect(result.skippedAdminQueue).toBe(1)
      expect(calls).toHaveLength(0)

      // No payouts row, Booking stays UNBATCHED so the admin queue surfaces it.
      expect(await db.select().from(payouts)).toHaveLength(0)
      const [b] = await db
        .select({ payoutBatchId: bookings.payoutBatchId })
        .from(bookings)
        .where(eq(bookings.id, bookingId))
      expect(b!.payoutBatchId).toBeNull()

      // An audit row records the skip with the reason.
      const audits = await db
        .select()
        .from(auditLogs)
        .where(eq(auditLogs.action, 'payout.batch_skipped'))
      expect(audits).toHaveLength(1)
      expect((audits[0]!.payload as { reason?: string }).reason).toBe('missing')
    })

    it('routes a group whose fund account is still COOLING OFF to the admin queue', async () => {
      const expId = await seedExperience()
      await seedCompletedBooking({ experienceId: expId })
      await db.insert(vendorFundAccounts).values({
        vendorUserId: 'u_v',
        destinationFingerprint: FP_A,
        razorpayFundAccountId: 'fa_A',
        coolingOffUntil: new Date(NOW.getTime() + 86_400_000), // still cooling
      })
      const { createPayout, calls } = makeStubPayout()

      const result = await processPayoutBatch({ db, now: NOW, batchDay: BATCH_DAY, createPayout })

      expect(result.skippedAdminQueue).toBe(1)
      expect(result.sent).toBe(0)
      expect(calls).toHaveLength(0)
      expect(await db.select().from(payouts)).toHaveLength(0)
      const audits = await db
        .select()
        .from(auditLogs)
        .where(eq(auditLogs.action, 'payout.batch_skipped'))
      expect((audits[0]!.payload as { reason?: string }).reason).toBe('cooling_off')
    })
  })

  describe('eligibility', () => {
    it('excludes a Booking still inside its maturity window', async () => {
      const expId = await seedExperience()
      await seedCompletedBooking({
        experienceId: expId,
        completedAt: new Date(NOW.getTime() - 3 * 86_400_000), // 3 < 7 days
      })
      await provisionFundAccount(FP_A, 'fa_A')
      const { createPayout, calls } = makeStubPayout()

      const result = await processPayoutBatch({ db, now: NOW, batchDay: BATCH_DAY, createPayout })
      expect(result.batchesPlanned).toBe(0)
      expect(calls).toHaveLength(0)
    })

    it('excludes a pending Booking when the vendor still has manual approvals remaining', async () => {
      await db
        .update(vendorProfiles)
        .set({ manualPayoutsRemaining: 2 })
        .where(eq(vendorProfiles.userId, 'u_v'))
      const expId = await seedExperience()
      await seedCompletedBooking({ experienceId: expId, payoutState: 'pending' })
      await provisionFundAccount(FP_A, 'fa_A')
      const { createPayout, calls } = makeStubPayout()

      const result = await processPayoutBatch({ db, now: NOW, batchDay: BATCH_DAY, createPayout })
      expect(result.batchesPlanned).toBe(0)
      expect(calls).toHaveLength(0)

      // restore for other tests
      await db
        .update(vendorProfiles)
        .set({ manualPayoutsRemaining: 0 })
        .where(eq(vendorProfiles.userId, 'u_v'))
    })

    it('excludes an already-batched Booking (payout_batch_id IS NOT NULL)', async () => {
      const expId = await seedExperience()
      const bookingId = await seedCompletedBooking({ experienceId: expId })
      await provisionFundAccount(FP_A, 'fa_A')
      // Pre-link the booking to an existing payouts row.
      const [pre] = await db
        .insert(payouts)
        .values({
          vendorUserId: 'u_v',
          destinationFingerprint: FP_A,
          razorpayFundAccountId: 'fa_A',
          batchDay: '2026-06-01',
          amountNetRupees: '7580.00',
          tdsTotal: '10.00',
          tcsTotal: '50.00',
          razorpayPayoutId: 'pout_old',
          status: 'paid',
        })
        .returning({ id: payouts.id })
      await db
        .update(bookings)
        .set({ payoutBatchId: pre!.id })
        .where(eq(bookings.id, bookingId))
      const { createPayout, calls } = makeStubPayout()

      const result = await processPayoutBatch({ db, now: NOW, batchDay: BATCH_DAY, createPayout })
      expect(result.batchesPlanned).toBe(0)
      expect(calls).toHaveLength(0)
    })
  })

  describe('at-most-once (the core invariant)', () => {
    it('running the worker TWICE produces at most one payout per (vendor, destination, batchDay)', async () => {
      const expId = await seedExperience()
      const bookingId = await seedCompletedBooking({ experienceId: expId })
      await provisionFundAccount(FP_A, 'fa_A')
      const { createPayout, calls } = makeStubPayout()

      const r1 = await processPayoutBatch({ db, now: NOW, batchDay: BATCH_DAY, createPayout })
      const r2 = await processPayoutBatch({ db, now: NOW, batchDay: BATCH_DAY, createPayout })

      // First run sent; second run finds the Booking already linked (so it is
      // no longer a candidate) and plans nothing — at most one transfer.
      expect(r1.sent).toBe(1)
      expect(r2.batchesPlanned).toBe(0)
      expect(r2.sent).toBe(0)

      // Exactly one effective transfer, one payouts row.
      expect(calls).toHaveLength(1)
      const rows = await db
        .select()
        .from(payouts)
        .where(
          and(
            eq(payouts.vendorUserId, 'u_v'),
            eq(payouts.destinationFingerprint, FP_A),
            eq(payouts.batchDay, BATCH_DAY),
          ),
        )
      expect(rows).toHaveLength(1)
      expect(rows[0]!.razorpayPayoutId).toBe('pout_1')

      // The Booking is linked exactly once.
      const [b] = await db
        .select({ payoutBatchId: bookings.payoutBatchId })
        .from(bookings)
        .where(eq(bookings.id, bookingId))
      expect(b!.payoutBatchId).toBe(rows[0]!.id)
    })

    it('does NOT re-send when a payouts row for the group already carries a razorpayPayoutId (overlap)', async () => {
      // Simulate an overlapping run: a payouts row for this exact (vendor,
      // destination, batchDay) already exists and its transfer was already
      // sent, but the member Booking has NOT yet been linked (the first run
      // crashed between the transfer and the link). The second run must observe
      // the already-sent row and skip — never a second transfer.
      const expId = await seedExperience()
      await seedCompletedBooking({ experienceId: expId })
      await provisionFundAccount(FP_A, 'fa_A')
      await db.insert(payouts).values({
        vendorUserId: 'u_v',
        destinationFingerprint: FP_A,
        razorpayFundAccountId: 'fa_A',
        batchDay: BATCH_DAY,
        amountNetRupees: '7580.00',
        tdsTotal: '10.00',
        tcsTotal: '50.00',
        razorpayPayoutId: 'pout_already',
        status: 'processing',
      })
      const { createPayout, calls } = makeStubPayout()

      const result = await processPayoutBatch({ db, now: NOW, batchDay: BATCH_DAY, createPayout })

      expect(result.batchesPlanned).toBe(1)
      expect(result.alreadySent).toBe(1)
      expect(result.sent).toBe(0)
      // No NEW transfer — the existing one stands.
      expect(calls).toHaveLength(0)
      const rows = await db.select().from(payouts)
      expect(rows).toHaveLength(1)
      expect(rows[0]!.razorpayPayoutId).toBe('pout_already')
    })
  })

  it('derives the IST batch day from `now` when batchDay is omitted (5pm-IST cron)', async () => {
    const expId = await seedExperience()
    await seedCompletedBooking({ experienceId: expId })
    await provisionFundAccount(FP_A, 'fa_A')
    const { createPayout } = makeStubPayout()

    // 2026-06-18T19:00:00Z is 2026-06-19 00:30 IST → the IST calendar day rolls
    // to the 19th, proving the +5:30 shift is applied (a naive UTC slice would
    // wrongly yield the 18th).
    const lateUtc = new Date('2026-06-18T19:00:00.000Z')
    await processPayoutBatch({ db, now: lateUtc, createPayout })

    const [row] = await db.select().from(payouts)
    expect(row!.batchDay).toBe('2026-06-19')
  })

  it('applies the T+30 window to a multi-day Booking computed from its slot span', async () => {
    // A slot spanning >1 calendar day completed 10 days ago: matured under T+7
    // but NOT under T+30 — the worker's isMultiDay must push it to T+30.
    const expId = await seedExperience()
    await seedCompletedBooking({
      experienceId: expId,
      multiDay: true,
      completedAt: new Date(NOW.getTime() - 10 * 86_400_000),
    })
    await provisionFundAccount(FP_A, 'fa_A')
    const { createPayout, calls } = makeStubPayout()

    const result = await processPayoutBatch({ db, now: NOW, batchDay: BATCH_DAY, createPayout })
    expect(result.batchesPlanned).toBe(0)
    expect(calls).toHaveLength(0)
  })

  it('returns an all-zero result when there is nothing eligible', async () => {
    const result = await processPayoutBatch({
      db,
      now: NOW,
      batchDay: BATCH_DAY,
      createPayout: makeStubPayout().createPayout,
    })
    expect(result).toEqual({
      batchesPlanned: 0,
      sent: 0,
      skippedAdminQueue: 0,
      alreadySent: 0,
    })
  })
})
