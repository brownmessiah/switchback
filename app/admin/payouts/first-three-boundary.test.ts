import { and, eq, isNull, sql } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { availabilitySlots } from '@/db/schema/availability-slots'
import { bookings } from '@/db/schema/bookings'
import { experiences } from '@/db/schema/experiences'
import { users } from '@/db/schema/users'
import { vendorProfiles } from '@/db/schema/vendor-profiles'
import {
  planPayoutBatches,
  type EligiblePayoutInput,
} from '@/lib/payments/payout-batch-planner'
import { setupTestDb, type TestDB } from '@/tests/helpers/db'

import { executeApprovePayout } from './actions'

/**
 * First-3 → auto BOUNDARY (slice 05, ADR-0016).
 *
 * The core acceptance of this slice: the manualPayoutsRemaining counter DRIVES
 * Payout Batch eligibility. We prove it end-to-end against the REAL slice-04
 * planner (no duplicated gate logic):
 *
 *  - Approving the first 3 Payouts decrements 3 → 0 (never below 0).
 *  - A 4th matured PENDING Payout is now BATCH-ELIGIBLE (planner includes it)
 *    with NO admin action — because the gate (remaining) hit 0.
 *  - While remaining > 0, a matured PENDING Payout is NOT batch-eligible and is
 *    held in the admin queue awaiting approval.
 */

const NOW = new Date('2026-06-18T11:30:00.000Z')
// Completed 30 days ago → matured under both the T+7 and T+30 windows.
const MATURED_AT = new Date(NOW.getTime() - 30 * 86_400_000)
const VPA = { vpa: 'first-three@upi' }

describe('first-3 → auto boundary (manualPayoutsRemaining drives batch eligibility)', () => {
  let db: TestDB
  let teardown: () => Promise<void>

  const ADMIN_ID = 'admin_b3'
  const VENDOR_ID = 'vendor_b3'

  beforeAll(async () => {
    const setup = await setupTestDb()
    db = setup.db
    teardown = setup.teardown
  })

  afterAll(async () => {
    await teardown()
  })

  beforeEach(async () => {
    await db.execute(
      sql`TRUNCATE TABLE audit_logs, bookings, availability_slots, experiences, vendor_profiles, users CASCADE`,
    )
    await db.insert(users).values([
      { id: ADMIN_ID, email: 'admin-b3@test.com' },
      { id: VENDOR_ID, email: 'vendor-b3@test.com' },
    ])
  })

  async function seedVendor(manualPayoutsRemaining: number): Promise<void> {
    await db.insert(vendorProfiles).values({
      userId: VENDOR_ID,
      businessName: 'Boundary Co',
      slug: 'boundary-co',
      kycTier: 'identity',
      commissionRate: '20.00',
      payoutMethod: 'upi',
      payoutDestination: VPA,
      manualPayoutsRemaining,
    })
  }

  async function seedExperience(): Promise<string> {
    const [exp] = await db
      .insert(experiences)
      .values({
        vendorUserId: VENDOR_ID,
        slug: `exp-${Math.random().toString(36).slice(2)}`,
        title: 'Boundary Experience',
        status: 'published',
        cancellationPreset: 'flexible',
        paymentModesAllowed: ['full_upfront'],
        pricePerPerson_1_2: '5000.00',
        pricePerPerson_3_5: '4500.00',
        pricePerPerson_6_plus: '4000.00',
        regionSlug: 'rishikesh',
        activitySlug: 'rafting',
        requiredPermits: [],
      })
      .returning({ id: experiences.id })
    return exp!.id
  }

  /** A matured, completed, single-day Booking with the payout snapshot fields. */
  async function seedMaturedPending(experienceId: string): Promise<string> {
    const jitterMs = Math.floor(Math.random() * 600) * 60_000
    const slotStart = new Date(new Date('2026-05-01T04:00:00.000Z').getTime() + jitterMs)
    const slotEnd = new Date(slotStart.getTime() + 60 * 60 * 1000)
    const [slot] = await db
      .insert(availabilitySlots)
      .values({ experienceId, startAt: slotStart, endAt: slotEnd, capacity: 8 })
      .returning({ id: availabilitySlots.id })
    const [booking] = await db
      .insert(bookings)
      .values({
        customerUserId: ADMIN_ID, // any user id is fine as the customer here
        experienceId,
        slotId: slot!.id,
        participantCount: 2,
        paymentMode: 'full_upfront',
        state: 'completed',
        completedAt: MATURED_AT,
        grossTotalSnapshot: '10000.00',
        pricePerParticipantSnapshot: '5000.00',
        pricingBasisSnapshot: 'experience_bracket:1_2',
        commissionRateSnapshot: '20.00',
        commissionBasisSnapshot: 'vendor_default',
        cancellationPresetSnapshot: 'flexible',
        tdsAmountSnapshot: '10.00',
        gstRateOnCommissionSnapshot: '18.00',
        tcsAmountSnapshot: '50.00',
        payoutMethodSnapshot: 'upi',
        payoutDestinationSnapshot: VPA,
        payoutState: 'pending',
      })
      .returning({ id: bookings.id })
    return booking!.id
  }

  /**
   * Build planner inputs from the live DB exactly as the slice-04 cron worker
   * does (same SELECT shape). We reuse the REAL planner — no duplicated gate.
   */
  async function planFromDb(): Promise<ReturnType<typeof planPayoutBatches>> {
    const candidates = await db
      .select({
        bookingId: bookings.id,
        vendorUserId: experiences.vendorUserId,
        completedAt: bookings.completedAt,
        requiredPermits: experiences.requiredPermits,
        slotStartAt: availabilitySlots.startAt,
        slotEndAt: availabilitySlots.endAt,
        payoutState: bookings.payoutState,
        manualPayoutsRemaining: vendorProfiles.manualPayoutsRemaining,
        payoutMethod: bookings.payoutMethodSnapshot,
        payoutDestinationSnapshot: bookings.payoutDestinationSnapshot,
        grossRupees: bookings.grossTotalSnapshot,
        commissionRatePercent: bookings.commissionRateSnapshot,
        gstRateOnCommissionPercent: bookings.gstRateOnCommissionSnapshot,
        tdsRupees: bookings.tdsAmountSnapshot,
        tcsRupees: bookings.tcsAmountSnapshot,
      })
      .from(bookings)
      .innerJoin(experiences, eq(experiences.id, bookings.experienceId))
      .innerJoin(vendorProfiles, eq(vendorProfiles.userId, experiences.vendorUserId))
      .innerJoin(availabilitySlots, eq(availabilitySlots.id, bookings.slotId))
      .where(and(eq(bookings.state, 'completed'), isNull(bookings.payoutBatchId)))

    const inputs: EligiblePayoutInput[] = candidates.map((c) => ({
      bookingId: c.bookingId,
      vendorUserId: c.vendorUserId,
      completedAt: c.completedAt,
      permitRequired: (c.requiredPermits ?? []).length > 0,
      multiDay: c.slotStartAt.toISOString().slice(0, 10) !== c.slotEndAt.toISOString().slice(0, 10),
      payoutState: c.payoutState as EligiblePayoutInput['payoutState'],
      vendorManualPayoutsRemaining: c.manualPayoutsRemaining,
      payoutMethod: c.payoutMethod as EligiblePayoutInput['payoutMethod'],
      payoutDestinationSnapshot: c.payoutDestinationSnapshot,
      grossRupees: Math.floor(Number(c.grossRupees)),
      commissionRatePercent: c.commissionRatePercent,
      gstRateOnCommissionPercent: c.gstRateOnCommissionPercent,
      tdsRupees: Math.floor(Number(c.tdsRupees)),
      tcsRupees: Math.floor(Number(c.tcsRupees)),
    }))

    return planPayoutBatches({ payouts: inputs, now: NOW, batchDay: '2026-06-18' })
  }

  it('approving the first 3 drives remaining 3 → 0, then the 4th matured PENDING Payout is batch-eligible with no admin step', async () => {
    await seedVendor(3)
    const expId = await seedExperience()

    // Three Payouts approved one at a time; remaining decrements 3 → 2 → 1 → 0.
    const expectedRemaining = [2, 1, 0]
    for (const remainingAfter of expectedRemaining) {
      const bookingId = await seedMaturedPending(expId)
      const result = await executeApprovePayout(db, ADMIN_ID, { bookingId })
      expect(result).toEqual({ ok: true })

      const [vendor] = await db
        .select({ manualPayoutsRemaining: vendorProfiles.manualPayoutsRemaining })
        .from(vendorProfiles)
        .where(eq(vendorProfiles.userId, VENDOR_ID))
      expect(vendor?.manualPayoutsRemaining).toBe(remainingAfter)
    }

    // The 4th Booking stays PENDING (no admin action). Because remaining is now
    // 0, the slice-04 planner INCLUDES it — proving the counter opened the gate.
    const fourth = await seedMaturedPending(expId)

    const planned = await planFromDb()
    const allMemberIds = planned.flatMap((b) => b.memberBookingIds)
    expect(allMemberIds).toContain(fourth)

    // Sanity: the 4th Booking is still pending — it flowed without approval.
    const [b] = await db
      .select({ payoutState: bookings.payoutState })
      .from(bookings)
      .where(eq(bookings.id, fourth))
    expect(b?.payoutState).toBe('pending')
  })

  it('never decrements below 0: a 4th approval with the gate already open stays at 0', async () => {
    await seedVendor(1)
    const expId = await seedExperience()

    const first = await seedMaturedPending(expId)
    await executeApprovePayout(db, ADMIN_ID, { bookingId: first })

    let [vendor] = await db
      .select({ manualPayoutsRemaining: vendorProfiles.manualPayoutsRemaining })
      .from(vendorProfiles)
      .where(eq(vendorProfiles.userId, VENDOR_ID))
    expect(vendor?.manualPayoutsRemaining).toBe(0)

    // A second approval with remaining already 0 must NOT go negative.
    const second = await seedMaturedPending(expId)
    await executeApprovePayout(db, ADMIN_ID, { bookingId: second })

    ;[vendor] = await db
      .select({ manualPayoutsRemaining: vendorProfiles.manualPayoutsRemaining })
      .from(vendorProfiles)
      .where(eq(vendorProfiles.userId, VENDOR_ID))
    expect(vendor?.manualPayoutsRemaining).toBe(0)
  })

  it('while remaining > 0, a matured PENDING Payout is NOT batch-eligible (held in the admin queue)', async () => {
    await seedVendor(2)
    const expId = await seedExperience()
    const bookingId = await seedMaturedPending(expId)

    const planned = await planFromDb()
    const allMemberIds = planned.flatMap((b) => b.memberBookingIds)
    expect(allMemberIds).not.toContain(bookingId)
    expect(planned).toHaveLength(0)
  })
})
