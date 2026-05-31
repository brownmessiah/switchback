import { eq, sql } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { setupTestDb, type TestDB } from '@/tests/helpers/db'

import { availabilitySlots } from './availability-slots'
import { bookings } from './bookings'
import { experiences } from './experiences'
import { users } from './users'
import { vendorProfiles } from './vendor-profiles'

/**
 * Snapshot rule structural safety net per ADRs 0008 / 0011 / 0016. The
 * 12 snapshot columns on bookings are locked at create and must never
 * change. The plpgsql trigger added in migration 0004 raises on any
 * UPDATE that mutates one of those columns. These tests confirm the
 * trigger fires for every column and stays out of the way for legitimate
 * UPDATEs to non-snapshot columns (state, completedAt, etc.).
 */
describe('bookings snapshot UPDATE lock (ADRs 0008/0011/0016)', () => {
  let db: TestDB
  let teardown: () => Promise<void>
  let bookingId: string

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
    })
    const [exp] = await db
      .insert(experiences)
      .values({
        vendorUserId: 'u_v',
        slug: 'rafting-day',
        title: 'Rafting Day',
        cancellationPreset: 'flexible',
        paymentModesAllowed: ['full_upfront', 'partial_pay'],
        pricePerPerson_1_2: '1500',
        pricePerPerson_3_5: '1300',
        pricePerPerson_6_plus: '1100',
        regionSlug: 'rishikesh',
        activitySlug: 'rafting',
      })
      .returning({ id: experiences.id })
    const [slot] = await db
      .insert(availabilitySlots)
      .values({
        experienceId: exp!.id,
        startAt: new Date('2026-09-15T08:00:00Z'),
        endAt: new Date('2026-09-15T12:00:00Z'),
        capacity: 8,
      })
      .returning({ id: availabilitySlots.id })

    const [b] = await db
      .insert(bookings)
      .values({
        customerUserId: 'u_c',
        experienceId: exp!.id,
        slotId: slot!.id,
        participantCount: 2,
        paymentMode: 'full_upfront',
        grossTotalSnapshot: '3000.00',
        pricePerParticipantSnapshot: '1500.00',
        pricingBasisSnapshot: 'experience_tier_1_2',
        commissionRateSnapshot: '20.00',
        commissionBasisSnapshot: 'vendor_default',
        cancellationPresetSnapshot: 'flexible',
        vendorPanSnapshot: 'ABCDE1234F',
        payoutMethodSnapshot: 'upi',
        payoutDestinationSnapshot: { vpa: 'vendor@upi' },
      })
      .returning({ id: bookings.id })
    bookingId = b!.id
  })

  afterAll(async () => {
    await teardown()
  })

  it('rejects UPDATE on gross_total_snapshot', async () => {
    await expect(
      db
        .update(bookings)
        .set({ grossTotalSnapshot: '9999.00' })
        .where(eq(bookings.id, bookingId)),
    ).rejects.toThrow(/snapshot/i)
  })

  it('rejects UPDATE on price_per_participant_snapshot', async () => {
    await expect(
      db
        .update(bookings)
        .set({ pricePerParticipantSnapshot: '9999.00' })
        .where(eq(bookings.id, bookingId)),
    ).rejects.toThrow(/snapshot/i)
  })

  it('rejects UPDATE on pricing_basis_snapshot', async () => {
    await expect(
      db
        .update(bookings)
        .set({ pricingBasisSnapshot: 'mutated' })
        .where(eq(bookings.id, bookingId)),
    ).rejects.toThrow(/snapshot/i)
  })

  it('rejects UPDATE on commission_rate_snapshot', async () => {
    await expect(
      db
        .update(bookings)
        .set({ commissionRateSnapshot: '5.00' })
        .where(eq(bookings.id, bookingId)),
    ).rejects.toThrow(/snapshot/i)
  })

  it('rejects UPDATE on commission_basis_snapshot', async () => {
    await expect(
      db
        .update(bookings)
        .set({ commissionBasisSnapshot: 'platform_default' })
        .where(eq(bookings.id, bookingId)),
    ).rejects.toThrow(/snapshot/i)
  })

  it('rejects UPDATE on cancellation_preset_snapshot', async () => {
    await expect(
      db
        .update(bookings)
        .set({ cancellationPresetSnapshot: 'strict' })
        .where(eq(bookings.id, bookingId)),
    ).rejects.toThrow(/snapshot/i)
  })

  it('rejects UPDATE on tds_amount_snapshot', async () => {
    await expect(
      db
        .update(bookings)
        .set({ tdsAmountSnapshot: '999.00' })
        .where(eq(bookings.id, bookingId)),
    ).rejects.toThrow(/snapshot/i)
  })

  it('rejects UPDATE on gst_rate_on_commission_snapshot', async () => {
    await expect(
      db
        .update(bookings)
        .set({ gstRateOnCommissionSnapshot: '12.00' })
        .where(eq(bookings.id, bookingId)),
    ).rejects.toThrow(/snapshot/i)
  })

  it('rejects UPDATE on vendor_pan_snapshot', async () => {
    await expect(
      db
        .update(bookings)
        .set({ vendorPanSnapshot: 'ZZZZZ9999Z' })
        .where(eq(bookings.id, bookingId)),
    ).rejects.toThrow(/snapshot/i)
  })

  it('rejects UPDATE on vendor_is_resident_snapshot', async () => {
    await expect(
      db
        .update(bookings)
        .set({ vendorIsResidentSnapshot: false })
        .where(eq(bookings.id, bookingId)),
    ).rejects.toThrow(/snapshot/i)
  })

  it('rejects UPDATE on payout_method_snapshot', async () => {
    await expect(
      db
        .update(bookings)
        .set({ payoutMethodSnapshot: 'bank_account' })
        .where(eq(bookings.id, bookingId)),
    ).rejects.toThrow(/snapshot/i)
  })

  it('rejects UPDATE on payout_destination_snapshot', async () => {
    await expect(
      db
        .update(bookings)
        .set({ payoutDestinationSnapshot: { vpa: 'attacker@upi' } })
        .where(eq(bookings.id, bookingId)),
    ).rejects.toThrow(/snapshot/i)
  })

  it('rejects UPDATE on tcs_amount_snapshot', async () => {
    await expect(
      db
        .update(bookings)
        .set({ tcsAmountSnapshot: '999.00' })
        .where(eq(bookings.id, bookingId)),
    ).rejects.toThrow(/snapshot/i)
  })

  it('rejects UPDATE on tcs_rate_snapshot', async () => {
    await expect(
      db
        .update(bookings)
        .set({ tcsRateSnapshot: '1.00' })
        .where(eq(bookings.id, bookingId)),
    ).rejects.toThrow(/snapshot/i)
  })

  it('allows UPDATE on state (lifecycle column)', async () => {
    await db
      .update(bookings)
      .set({ state: 'awaiting_completion' })
      .where(eq(bookings.id, bookingId))
    const [row] = await db.select({ state: bookings.state }).from(bookings).where(eq(bookings.id, bookingId))
    expect(row?.state).toBe('awaiting_completion')
  })

  it('allows UPDATE on completed_at and auto_completed', async () => {
    const when = new Date('2026-09-15T13:00:00Z')
    await db
      .update(bookings)
      .set({ state: 'completed', completedAt: when, autoCompleted: true })
      .where(eq(bookings.id, bookingId))
    const [row] = await db
      .select({
        state: bookings.state,
        completedAt: bookings.completedAt,
        autoCompleted: bookings.autoCompleted,
      })
      .from(bookings)
      .where(eq(bookings.id, bookingId))
    expect(row?.state).toBe('completed')
    expect(row?.autoCompleted).toBe(true)
    expect(row?.completedAt?.toISOString()).toBe(when.toISOString())
  })

  it('allows UPDATE on cancelled_at and cancellation_reason', async () => {
    const when = new Date('2026-09-14T22:00:00Z')
    await db
      .update(bookings)
      .set({
        state: 'cancelled_by_customer',
        cancelledAt: when,
        cancellationReason: 'inside_policy_free_window',
      })
      .where(eq(bookings.id, bookingId))
    const [row] = await db
      .select({ reason: bookings.cancellationReason })
      .from(bookings)
      .where(eq(bookings.id, bookingId))
    expect(row?.reason).toBe('inside_policy_free_window')
  })

  it('UPDATE that sets snapshot column to its current value is a no-op (IS DISTINCT FROM)', async () => {
    // Setting commission_rate_snapshot to the SAME value should NOT raise —
    // the trigger uses IS DISTINCT FROM so equal values are allowed.
    await db
      .update(bookings)
      .set({ commissionRateSnapshot: '20.00' })
      .where(eq(bookings.id, bookingId))
    const [row] = await db
      .select({ rate: bookings.commissionRateSnapshot })
      .from(bookings)
      .where(eq(bookings.id, bookingId))
    expect(row?.rate).toBe('20.00')
  })

  it('rejects multi-column UPDATE that touches even one snapshot column', async () => {
    await expect(
      db
        .update(bookings)
        .set({ state: 'awaiting_completion', commissionRateSnapshot: '15.00' })
        .where(eq(bookings.id, bookingId)),
    ).rejects.toThrow(/snapshot/i)
  })

  it('does not affect INSERT (snapshot writes are allowed at create-time)', async () => {
    // Verified implicitly by the existing bookings.test.ts insertion tests
    // (they continue to pass with the trigger installed). Sanity-check it
    // here too by selecting and asserting the seeded row's snapshot fields.
    const [row] = await db.select().from(bookings).where(eq(bookings.id, bookingId))
    expect(row?.commissionRateSnapshot).toBe('20.00')
  })

  it('truncating bookings still works (TRUNCATE bypasses row triggers, by design)', async () => {
    await db.execute(sql`TRUNCATE TABLE payments, refund_requests, bookings CASCADE`)
    const rows = await db.select().from(bookings)
    expect(rows).toHaveLength(0)
  })
})
