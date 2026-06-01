import { eq, sql } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { availabilitySlots } from '@/db/schema/availability-slots'
import { bookings } from '@/db/schema/bookings'
import { experiences } from '@/db/schema/experiences'
import { tripGroups } from '@/db/schema/trip-groups'
import { users } from '@/db/schema/users'
import { vendorProfiles } from '@/db/schema/vendor-profiles'
import { setupTestDb, type TestDB } from '@/tests/helpers/db'

import {
  assertCanBookForGroup,
  getSlotBookingProgress,
} from './booking-linkage'
import {
  archiveGroup,
  lockItinerary,
  markCompleted,
  markTraveling,
  sweepAutoArchive,
} from './group-transitions'
import { createTripGroup } from './groups'
import { addItinerarySlot } from './itinerary'
import { requestToJoin } from './membership'

const DAY = 86_400_000

describe('trip-group transitions + booking linkage (ADR-0009)', () => {
  let db: TestDB
  let teardown: () => Promise<void>
  let expId: string
  let slotDbId: string

  beforeAll(async () => {
    const setup = await setupTestDb()
    db = setup.db
    teardown = setup.teardown
    await db.insert(users).values([
      { id: 'u_host', email: 'h@t.com', name: 'Host' },
      { id: 'u_m1', email: 'm1@t.com', name: 'M1' },
      { id: 'u_m2', email: 'm2@t.com', name: 'M2' },
      { id: 'u_outsider', email: 'o@t.com', name: 'Out' },
      { id: 'u_vendor', email: 'v@t.com', name: 'V' },
    ])
    await db.insert(vendorProfiles).values({
      userId: 'u_vendor',
      businessName: 'Adv',
      slug: 'adv',
      commissionRate: '20.00',
    })
  })

  afterAll(async () => {
    await teardown()
  })

  beforeEach(async () => {
    await db.execute(
      sql`TRUNCATE TABLE bookings, availability_slots, trip_group_itinerary_slots, trip_group_members, trip_groups, experiences CASCADE`,
    )
    const [exp] = await db
      .insert(experiences)
      .values({
        vendorUserId: 'u_vendor',
        slug: 'raft',
        title: 'Rafting',
        cancellationPreset: 'flexible',
        paymentModesAllowed: ['full_upfront'],
        pricePerPerson_1_2: '1500.00',
        pricePerPerson_3_5: '1300.00',
        pricePerPerson_6_plus: '1100.00',
        regionSlug: 'rishikesh',
        activitySlug: 'rafting',
        status: 'published',
      })
      .returning({ id: experiences.id })
    expId = exp!.id
    const [slot] = await db
      .insert(availabilitySlots)
      .values({
        experienceId: expId,
        startAt: new Date('2026-10-01T09:00:00Z'),
        endAt: new Date('2026-10-01T12:00:00Z'),
        capacity: 12,
      })
      .returning({ id: availabilitySlots.id })
    slotDbId = slot!.id
  })

  async function seedBookableGroup(): Promise<string> {
    const { id } = await createTripGroup(db, { hostUserId: 'u_host', name: 'G', maxMembers: 6 })
    await requestToJoin(db, { groupId: id, userId: 'u_m1' }) // → planning
    await addItinerarySlot(db, {
      groupId: id,
      dayOffset: 0,
      timeBand: 'morning',
      experienceId: expId,
      userId: 'u_host',
    })
    await lockItinerary(db, { groupId: id, hostUserId: 'u_host' }) // planning → booking
    return id
  }

  async function seedGroupBooking(groupId: string, userId: string, state = 'confirmed') {
    await db.insert(bookings).values({
      customerUserId: userId,
      experienceId: expId,
      slotId: slotDbId,
      participantCount: 1,
      paymentMode: 'full_upfront',
      state: state as 'confirmed',
      grossTotalSnapshot: '1500.00',
      pricePerParticipantSnapshot: '1500.00',
      pricingBasisSnapshot: 'experience_bracket:1_2',
      commissionRateSnapshot: '20.00',
      commissionBasisSnapshot: 'vendor_default',
      cancellationPresetSnapshot: 'flexible',
      tdsAmountSnapshot: '15.00',
      gstRateOnCommissionSnapshot: '18.00',
      vendorIsResidentSnapshot: true,
      tripGroupId: groupId,
    })
  }

  // ── lifecycle transitions ─────────────────────────────────────────
  it('host locks itinerary (planning → booking); empty itinerary rejected', async () => {
    const { id } = await createTripGroup(db, { hostUserId: 'u_host', name: 'G', maxMembers: 6 })
    await requestToJoin(db, { groupId: id, userId: 'u_m1' }) // forming → planning
    await expect(lockItinerary(db, { groupId: id, hostUserId: 'u_host' })).rejects.toMatchObject({
      code: 'INVALID_INPUT', // empty itinerary
    })
    await addItinerarySlot(db, { groupId: id, dayOffset: 0, timeBand: 'am', freeText: 'x', userId: 'u_host' })
    await lockItinerary(db, { groupId: id, hostUserId: 'u_host' })
    const [g] = await db.select({ s: tripGroups.status }).from(tripGroups).where(eq(tripGroups.id, id))
    expect(g?.s).toBe('booking')
  })

  it('rejects lock by a non-host', async () => {
    const { id } = await createTripGroup(db, { hostUserId: 'u_host', name: 'G', maxMembers: 6 })
    await requestToJoin(db, { groupId: id, userId: 'u_m1' })
    await addItinerarySlot(db, { groupId: id, dayOffset: 0, timeBand: 'am', freeText: 'x', userId: 'u_host' })
    await expect(lockItinerary(db, { groupId: id, hostUserId: 'u_m1' })).rejects.toMatchObject({
      code: 'NOT_HOST',
    })
  })

  it('advances booking → traveling → completed; archive from any non-terminal', async () => {
    const id = await seedBookableGroup()
    await markTraveling(db, { groupId: id, hostUserId: 'u_host' })
    await markCompleted(db, { groupId: id, hostUserId: 'u_host' })
    let [g] = await db.select({ s: tripGroups.status }).from(tripGroups).where(eq(tripGroups.id, id))
    expect(g?.s).toBe('completed')
    await archiveGroup(db, { groupId: id, hostUserId: 'u_host' })
    ;[g] = await db.select({ s: tripGroups.status }).from(tripGroups).where(eq(tripGroups.id, id))
    expect(g?.s).toBe('archived')
  })

  it('rejects an illegal transition (booking → completed skips traveling)', async () => {
    const id = await seedBookableGroup()
    await expect(markCompleted(db, { groupId: id, hostUserId: 'u_host' })).rejects.toMatchObject({
      code: 'INVALID_TRANSITION',
    })
  })

  // ── auto-archive sweep ────────────────────────────────────────────
  it('sweepAutoArchive archives 30d-stale forming + 60d-old completed, leaves fresh', async () => {
    const now = new Date('2026-12-01T00:00:00Z')
    const { id: stale } = await createTripGroup(db, { hostUserId: 'u_host', name: 'Stale', maxMembers: 6 })
    const { id: fresh } = await createTripGroup(db, { hostUserId: 'u_host', name: 'Fresh', maxMembers: 6 })
    await db
      .update(tripGroups)
      .set({ createdAt: new Date(now.getTime() - 31 * DAY) })
      .where(eq(tripGroups.id, stale))
    // Pin the fresh group's createdAt to `now` (the row was inserted at real
    // wall-clock, which is months before the test's fixed `now`).
    await db.update(tripGroups).set({ createdAt: now }).where(eq(tripGroups.id, fresh))

    const archivedCount = await sweepAutoArchive(db, now)
    expect(archivedCount).toBe(1)
    const [s] = await db.select({ s: tripGroups.status }).from(tripGroups).where(eq(tripGroups.id, stale))
    const [f] = await db.select({ s: tripGroups.status }).from(tripGroups).where(eq(tripGroups.id, fresh))
    expect(s?.s).toBe('archived')
    expect(f?.s).toBe('forming')
  })

  // ── booking linkage ───────────────────────────────────────────────
  it('assertCanBookForGroup: active member + booking phase + itinerary experience passes', async () => {
    const id = await seedBookableGroup()
    await expect(
      assertCanBookForGroup(db, { groupId: id, userId: 'u_m1', experienceId: expId }),
    ).resolves.toBeUndefined()
  })

  it('assertCanBookForGroup rejects outsiders, wrong phase, off-itinerary experiences', async () => {
    const { id: planning } = await createTripGroup(db, { hostUserId: 'u_host', name: 'P', maxMembers: 6 })
    await requestToJoin(db, { groupId: planning, userId: 'u_m1' })
    // still planning (not locked) → not bookable
    await expect(
      assertCanBookForGroup(db, { groupId: planning, userId: 'u_m1', experienceId: expId }),
    ).rejects.toMatchObject({ code: 'INVALID_TRANSITION' })

    const id = await seedBookableGroup()
    // outsider is not a member
    await expect(
      assertCanBookForGroup(db, { groupId: id, userId: 'u_outsider', experienceId: expId }),
    ).rejects.toMatchObject({ code: 'NOT_MEMBER' })
    // an experience not in the itinerary
    await expect(
      assertCanBookForGroup(db, {
        groupId: id,
        userId: 'u_m1',
        experienceId: '00000000-0000-0000-0000-000000000000',
      }),
    ).rejects.toMatchObject({ code: 'EXPERIENCE_NOT_GROUNDED' })
  })

  it('getSlotBookingProgress reports booked members; excludes cancelled (isolation)', async () => {
    const id = await seedBookableGroup()
    await seedGroupBooking(id, 'u_host', 'confirmed')
    await seedGroupBooking(id, 'u_m1', 'cancelled_by_customer') // m1 dropped out

    const progress = await getSlotBookingProgress(db, id)
    expect(progress).toHaveLength(1)
    expect(progress[0]?.experienceId).toBe(expId)
    // Only the live (confirmed) booking shows; the cancelled one is excluded —
    // m1's cancellation affects no other member's slot status.
    expect(progress[0]?.bookedByUserIds).toEqual(['u_host'])
  })
})
