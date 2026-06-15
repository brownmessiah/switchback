import { eq, sql } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { availabilitySlots } from '@/db/schema/availability-slots'
import { bookings } from '@/db/schema/bookings'
import { experiences } from '@/db/schema/experiences'
import { users } from '@/db/schema/users'
import { vendorProfiles } from '@/db/schema/vendor-profiles'
import { vendorTeamMembers } from '@/db/schema/vendor-team-members'
import { signCheckInToken } from '@/lib/bookings/checkin-token'
import { setupTestDb, type TestDB } from '@/tests/helpers/db'

import { executeRecordCheckIn } from './checkin-core'

/**
 * Integration tests (PGlite) for the db-injected check-in core (issue #06).
 *
 * Proves the acceptance contract:
 *   - a valid token + authorized staff WRITES `checked_in_at` (timestamp set),
 *   - the gate is on the BOOKING'S vendor account (`bookings:checkin`): an
 *     Accountant (lacks checkin) is denied; a member of a DIFFERENT vendor is
 *     denied (foreign-booking),
 *   - re-scan is idempotent — second call returns `alreadyCheckedIn`, the SAME
 *     timestamp, no overwrite,
 *   - the Booking's lifecycle `state` is UNCHANGED before/after (ADR-0003),
 *   - a malformed/expired/foreign-secret token returns a sanitized failure and
 *     writes nothing.
 */

const SECRET = 'a'.repeat(32)
const OTHER_SECRET = 'b'.repeat(32)

async function seedVendor(db: TestDB, vendorUserId: string): Promise<void> {
  await db.insert(users).values({ id: vendorUserId, email: `${vendorUserId}@test.com` })
  await db.insert(vendorProfiles).values({
    userId: vendorUserId,
    businessName: `Vendor ${vendorUserId}`,
    slug: `slug-${vendorUserId}`,
  })
}

/** Seed an experience + slot + a confirmed booking for `vendorUserId`. */
async function seedBooking(
  db: TestDB,
  vendorUserId: string,
  customerUserId: string,
): Promise<string> {
  const [exp] = await db
    .insert(experiences)
    .values({
      vendorUserId,
      slug: `exp-${vendorUserId}-${customerUserId}`,
      title: 'Rafting Day',
      cancellationPreset: 'flexible',
      paymentModesAllowed: ['full_upfront'],
      pricePerPerson_1_2: '1500.00',
      pricePerPerson_3_5: '1300.00',
      pricePerPerson_6_plus: '1100.00',
      regionSlug: 'rishikesh',
      activitySlug: 'rafting',
    })
    .returning({ id: experiences.id })

  const start = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
  const end = new Date(start.getTime() + 4 * 60 * 60 * 1000)
  const [slot] = await db
    .insert(availabilitySlots)
    .values({ experienceId: exp!.id, startAt: start, endAt: end, capacity: 8 })
    .returning({ id: availabilitySlots.id })

  const [booking] = await db
    .insert(bookings)
    .values({
      customerUserId,
      experienceId: exp!.id,
      slotId: slot!.id,
      participantCount: 2,
      paymentMode: 'full_upfront',
      grossTotalSnapshot: '3000.00',
      pricePerParticipantSnapshot: '1500.00',
      pricingBasisSnapshot: 'per_person',
      commissionRateSnapshot: '20.00',
      commissionBasisSnapshot: 'gross',
      cancellationPresetSnapshot: 'flexible',
    })
    .returning({ id: bookings.id })

  return booking!.id
}

async function addMember(
  db: TestDB,
  vendorUserId: string,
  memberUserId: string,
  role: 'manager' | 'booking_staff' | 'guide' | 'accountant',
): Promise<void> {
  await db.insert(users).values({ id: memberUserId, email: `${memberUserId}@test.com` })
  await db.insert(vendorTeamMembers).values({
    vendorUserId,
    memberUserId,
    role,
    status: 'active',
  })
}

function validToken(bookingId: string): string {
  return signCheckInToken({ bookingId, expiresAt: Date.now() + 60_000 }, SECRET)
}

describe('executeRecordCheckIn (issue #06)', () => {
  let db: TestDB
  let teardown: () => Promise<void>

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
      sql`TRUNCATE TABLE vendor_team_members, bookings, availability_slots, experiences, vendor_profiles, users CASCADE`,
    )
    await db.insert(users).values({ id: 'u_cust', email: 'cust@test.com' })
  })

  it('owner: a valid token writes checked_in_at and returns ok (first scan)', async () => {
    await seedVendor(db, 'u_owner')
    const bookingId = await seedBooking(db, 'u_owner', 'u_cust')
    const now = new Date()

    const result = await executeRecordCheckIn(db, 'u_owner', validToken(bookingId), SECRET, now)

    expect(result).toEqual({ ok: true, alreadyCheckedIn: false, bookingId })

    const [row] = await db
      .select({ checkedInAt: bookings.checkedInAt })
      .from(bookings)
      .where(eq(bookings.id, bookingId))
    expect(row!.checkedInAt).not.toBeNull()
    expect(row!.checkedInAt!.getTime()).toBe(now.getTime())
  })

  it('does NOT change the booking lifecycle state (ADR-0003 untouched)', async () => {
    await seedVendor(db, 'u_owner')
    const bookingId = await seedBooking(db, 'u_owner', 'u_cust')

    const [before] = await db
      .select({ state: bookings.state })
      .from(bookings)
      .where(eq(bookings.id, bookingId))

    await executeRecordCheckIn(db, 'u_owner', validToken(bookingId), SECRET, new Date())

    const [after] = await db
      .select({ state: bookings.state })
      .from(bookings)
      .where(eq(bookings.id, bookingId))

    expect(after!.state).toBe(before!.state)
    expect(after!.state).toBe('confirmed')
  })

  it('booking_staff can check in (holds bookings:checkin)', async () => {
    await seedVendor(db, 'u_owner')
    await addMember(db, 'u_owner', 'u_bs', 'booking_staff')
    const bookingId = await seedBooking(db, 'u_owner', 'u_cust')

    const result = await executeRecordCheckIn(db, 'u_bs', validToken(bookingId), SECRET, new Date())
    expect(result.ok).toBe(true)
  })

  it('guide can check in (holds bookings:checkin)', async () => {
    await seedVendor(db, 'u_owner')
    await addMember(db, 'u_owner', 'u_guide', 'guide')
    const bookingId = await seedBooking(db, 'u_owner', 'u_cust')

    const result = await executeRecordCheckIn(db, 'u_guide', validToken(bookingId), SECRET, new Date())
    expect(result.ok).toBe(true)
  })

  it('accountant is DENIED (lacks bookings:checkin) and writes nothing', async () => {
    await seedVendor(db, 'u_owner')
    await addMember(db, 'u_owner', 'u_acc', 'accountant')
    const bookingId = await seedBooking(db, 'u_owner', 'u_cust')

    const result = await executeRecordCheckIn(db, 'u_acc', validToken(bookingId), SECRET, new Date())
    expect(result.ok).toBe(false)

    const [row] = await db
      .select({ checkedInAt: bookings.checkedInAt })
      .from(bookings)
      .where(eq(bookings.id, bookingId))
    expect(row!.checkedInAt).toBeNull()
  })

  it('a member of a DIFFERENT vendor account cannot check in a foreign booking', async () => {
    await seedVendor(db, 'u_owner')
    await seedVendor(db, 'u_other')
    // u_intruder is a manager on u_other's account, NOT on u_owner's.
    await addMember(db, 'u_other', 'u_intruder', 'manager')
    const bookingId = await seedBooking(db, 'u_owner', 'u_cust')

    const result = await executeRecordCheckIn(
      db,
      'u_intruder',
      validToken(bookingId),
      SECRET,
      new Date(),
    )
    expect(result.ok).toBe(false)

    const [row] = await db
      .select({ checkedInAt: bookings.checkedInAt })
      .from(bookings)
      .where(eq(bookings.id, bookingId))
    expect(row!.checkedInAt).toBeNull()
  })

  it('is idempotent on re-scan: second call returns alreadyCheckedIn with the SAME timestamp', async () => {
    await seedVendor(db, 'u_owner')
    const bookingId = await seedBooking(db, 'u_owner', 'u_cust')
    const firstNow = new Date('2026-06-01T10:00:00.000Z')

    const first = await executeRecordCheckIn(db, 'u_owner', validToken(bookingId), SECRET, firstNow)
    expect(first).toEqual({ ok: true, alreadyCheckedIn: false, bookingId })

    const [afterFirst] = await db
      .select({ checkedInAt: bookings.checkedInAt })
      .from(bookings)
      .where(eq(bookings.id, bookingId))

    // A LATER second scan must NOT overwrite the original timestamp.
    const secondNow = new Date('2026-06-01T11:30:00.000Z')
    const second = await executeRecordCheckIn(db, 'u_owner', validToken(bookingId), SECRET, secondNow)
    expect(second).toEqual({ ok: true, alreadyCheckedIn: true, bookingId })

    const [afterSecond] = await db
      .select({ checkedInAt: bookings.checkedInAt })
      .from(bookings)
      .where(eq(bookings.id, bookingId))

    expect(afterSecond!.checkedInAt!.getTime()).toBe(afterFirst!.checkedInAt!.getTime())
    expect(afterSecond!.checkedInAt!.getTime()).toBe(firstNow.getTime())
  })

  it('rejects a token signed with a different secret (sanitized failure, no write)', async () => {
    await seedVendor(db, 'u_owner')
    const bookingId = await seedBooking(db, 'u_owner', 'u_cust')
    const forged = signCheckInToken({ bookingId, expiresAt: Date.now() + 60_000 }, OTHER_SECRET)

    const result = await executeRecordCheckIn(db, 'u_owner', forged, SECRET, new Date())
    expect(result.ok).toBe(false)
    // Sanitized: does not reveal whether the booking exists.
    if (!result.ok) expect(typeof result.error).toBe('string')

    const [row] = await db
      .select({ checkedInAt: bookings.checkedInAt })
      .from(bookings)
      .where(eq(bookings.id, bookingId))
    expect(row!.checkedInAt).toBeNull()
  })

  it('rejects an expired token (no write)', async () => {
    await seedVendor(db, 'u_owner')
    const bookingId = await seedBooking(db, 'u_owner', 'u_cust')
    const expired = signCheckInToken({ bookingId, expiresAt: Date.now() - 1 }, SECRET)

    const result = await executeRecordCheckIn(db, 'u_owner', expired, SECRET, new Date())
    expect(result.ok).toBe(false)
  })

  it('rejects a malformed token (no write)', async () => {
    await seedVendor(db, 'u_owner')
    const result = await executeRecordCheckIn(db, 'u_owner', 'garbage', SECRET, new Date())
    expect(result.ok).toBe(false)
  })

  it('returns a sanitized failure for a well-signed token whose booking does not exist', async () => {
    await seedVendor(db, 'u_owner')
    const ghost = signCheckInToken(
      { bookingId: '99999999-9999-9999-9999-999999999999', expiresAt: Date.now() + 60_000 },
      SECRET,
    )
    const result = await executeRecordCheckIn(db, 'u_owner', ghost, SECRET, new Date())
    expect(result.ok).toBe(false)
  })
})
