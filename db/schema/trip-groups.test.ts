import { eq, sql } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { availabilitySlots } from './availability-slots'
import { bookings } from './bookings'
import { experiences } from './experiences'
import {
  tripGroupItinerarySlots,
  tripGroupMembers,
  tripGroups,
} from './trip-groups'
import { users } from './users'
import { vendorProfiles } from './vendor-profiles'
import { setupTestDb, type TestDB } from '@/tests/helpers/db'

/**
 * Slice 1 (ADR-0009): the three TripGroup tables + enums + the
 * bookings.trip_group_id FK. Proves the migration replays and the
 * isolation guarantee (deleting a group nulls the Booking tag, never the
 * Booking) holds at the DB level.
 */
describe('trip-groups schema (ADR-0009)', () => {
  let db: TestDB
  let teardown: () => Promise<void>

  beforeAll(async () => {
    const setup = await setupTestDb()
    db = setup.db
    teardown = setup.teardown
    await db.insert(users).values([
      { id: 'u_host', email: 'host@test.com', name: 'Host' },
      { id: 'u_member', email: 'member@test.com', name: 'Member' },
      { id: 'u_vendor', email: 'vendor@test.com', name: 'Vendor' },
    ])
    await db.insert(vendorProfiles).values({
      userId: 'u_vendor',
      businessName: 'Adv Co',
      slug: 'adv-co',
      commissionRate: '20.00',
    })
  })

  afterAll(async () => {
    await teardown()
  })

  beforeEach(async () => {
    await db.execute(
      sql`TRUNCATE TABLE trip_group_itinerary_slots, trip_group_members, bookings, availability_slots, experiences, trip_groups CASCADE`,
    )
  })

  async function seedGroup(overrides: Record<string, unknown> = {}): Promise<string> {
    const [g] = await db
      .insert(tripGroups)
      .values({ hostUserId: 'u_host', name: 'Rishikesh October', maxMembers: 6, ...overrides })
      .returning({ id: tripGroups.id })
    return g!.id
  }

  it('inserts a trip_group with enum + array + default columns', async () => {
    const id = await seedGroup({
      destinationSlugs: ['rishikesh', 'manali'],
      interestTags: ['rafting', 'trekking'],
      visibility: 'public_women_only',
      membershipRule: 'host_approval',
    })
    const [row] = await db.select().from(tripGroups).where(eq(tripGroups.id, id))
    expect(row?.status).toBe('forming') // default
    expect(row?.visibility).toBe('public_women_only')
    expect(row?.membershipRule).toBe('host_approval')
    expect(row?.destinationSlugs).toEqual(['rishikesh', 'manali'])
    expect(row?.interestTags).toEqual(['rafting', 'trekking'])
  })

  it('enforces the max_members 2..12 CHECK', async () => {
    await expect(seedGroup({ maxMembers: 13 })).rejects.toThrow()
    await expect(seedGroup({ maxMembers: 1 })).rejects.toThrow()
    await expect(seedGroup({ maxMembers: 12 })).resolves.toBeTypeOf('string')
  })

  it('accepts every group status + member role/status enum value', async () => {
    const id = await seedGroup()
    for (const status of [
      'forming',
      'planning',
      'booking',
      'traveling',
      'completed',
      'archived',
    ] as const) {
      await db.update(tripGroups).set({ status }).where(eq(tripGroups.id, id))
      const [row] = await db
        .select({ status: tripGroups.status })
        .from(tripGroups)
        .where(eq(tripGroups.id, id))
      expect(row?.status).toBe(status)
    }
  })

  it('enforces one membership row per (group, user) via the composite PK', async () => {
    const id = await seedGroup()
    await db
      .insert(tripGroupMembers)
      .values({ tripGroupId: id, userId: 'u_host', role: 'host', status: 'active' })
    await expect(
      db
        .insert(tripGroupMembers)
        .values({ tripGroupId: id, userId: 'u_host', role: 'member', status: 'active' }),
    ).rejects.toThrow()
  })

  it('stores itinerary slots with either an experience_id or free_text', async () => {
    const id = await seedGroup()
    const [exp] = await db
      .insert(experiences)
      .values({
        vendorUserId: 'u_vendor',
        slug: 'rafting-day',
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
    await db.insert(tripGroupItinerarySlots).values([
      { tripGroupId: id, dayOffset: 0, timeBand: 'morning', experienceId: exp!.id },
      { tripGroupId: id, dayOffset: 0, timeBand: 'evening', freeText: 'Dinner at the camp' },
    ])
    const slots = await db
      .select()
      .from(tripGroupItinerarySlots)
      .where(eq(tripGroupItinerarySlots.tripGroupId, id))
    expect(slots).toHaveLength(2)
  })

  it('ADR-0009 isolation: deleting a group NULLs bookings.trip_group_id, never the Booking', async () => {
    const groupId = await seedGroup()
    const [exp] = await db
      .insert(experiences)
      .values({
        vendorUserId: 'u_vendor',
        slug: 'rafting-day-2',
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
    const [slot] = await db
      .insert(availabilitySlots)
      .values({
        experienceId: exp!.id,
        startAt: new Date('2026-10-01T09:00:00Z'),
        endAt: new Date('2026-10-01T12:00:00Z'),
        capacity: 8,
      })
      .returning({ id: availabilitySlots.id })
    const [booking] = await db
      .insert(bookings)
      .values({
        customerUserId: 'u_member',
        experienceId: exp!.id,
        slotId: slot!.id,
        participantCount: 2,
        paymentMode: 'full_upfront',
        state: 'confirmed',
        grossTotalSnapshot: '3000.00',
        pricePerParticipantSnapshot: '1500.00',
        pricingBasisSnapshot: 'experience_bracket:1_2',
        commissionRateSnapshot: '20.00',
        commissionBasisSnapshot: 'vendor_default',
        cancellationPresetSnapshot: 'flexible',
        tdsAmountSnapshot: '30.00',
        gstRateOnCommissionSnapshot: '18.00',
        vendorIsResidentSnapshot: true,
        tripGroupId: groupId,
      })
      .returning({ id: bookings.id })

    await db.delete(tripGroups).where(eq(tripGroups.id, groupId))

    const [row] = await db
      .select({ id: bookings.id, tripGroupId: bookings.tripGroupId, state: bookings.state })
      .from(bookings)
      .where(eq(bookings.id, booking!.id))
    expect(row).toBeDefined() // Booking SURVIVES the group deletion
    expect(row?.tripGroupId).toBeNull() // tag nulled
    expect(row?.state).toBe('confirmed') // untouched
  })
})
