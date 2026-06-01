import { eq, sql } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { experiences } from '@/db/schema/experiences'
import { tripGroupItinerarySlots } from '@/db/schema/trip-groups'
import { users } from '@/db/schema/users'
import { vendorProfiles } from '@/db/schema/vendor-profiles'
import { setupTestDb, type TestDB } from '@/tests/helpers/db'

import { createTripGroup } from './groups'
import {
  addItinerarySlot,
  deleteItinerarySlot,
  listItinerary,
  updateItinerarySlot,
} from './itinerary'

describe('trip-group itinerary (ADR-0009)', () => {
  let db: TestDB
  let teardown: () => Promise<void>
  let groupId: string
  let publishedExpId: string
  let draftExpId: string

  beforeAll(async () => {
    const setup = await setupTestDb()
    db = setup.db
    teardown = setup.teardown
    await db.insert(users).values([
      { id: 'u_host', email: 'h@t.com', name: 'Host' },
      { id: 'u_member', email: 'm@t.com', name: 'Member' },
      { id: 'u_vendor', email: 'v@t.com', name: 'Vendor' },
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
      sql`TRUNCATE TABLE trip_group_itinerary_slots, trip_group_members, trip_groups, experiences CASCADE`,
    )
    const [pub] = await db
      .insert(experiences)
      .values({
        vendorUserId: 'u_vendor',
        slug: 'pub-raft',
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
    publishedExpId = pub!.id
    const [draft] = await db
      .insert(experiences)
      .values({
        vendorUserId: 'u_vendor',
        slug: 'draft-raft',
        title: 'Draft Rafting',
        cancellationPreset: 'flexible',
        paymentModesAllowed: ['full_upfront'],
        pricePerPerson_1_2: '1500.00',
        pricePerPerson_3_5: '1300.00',
        pricePerPerson_6_plus: '1100.00',
        regionSlug: 'rishikesh',
        activitySlug: 'rafting',
        status: 'draft',
      })
      .returning({ id: experiences.id })
    draftExpId = draft!.id
    const created = await createTripGroup(db, { hostUserId: 'u_host', name: 'G', maxMembers: 6 })
    groupId = created.id
  })

  it('adds a slot grounded on a published Experience', async () => {
    const { id } = await addItinerarySlot(db, {
      groupId,
      dayOffset: 0,
      timeBand: 'morning',
      experienceId: publishedExpId,
      userId: 'u_host',
    })
    const [slot] = await db
      .select()
      .from(tripGroupItinerarySlots)
      .where(eq(tripGroupItinerarySlots.id, id))
    expect(slot?.experienceId).toBe(publishedExpId)
    expect(slot?.updatedByUserId).toBe('u_host')
  })

  it('adds a free-text slot', async () => {
    const { id } = await addItinerarySlot(db, {
      groupId,
      dayOffset: 0,
      timeBand: 'evening',
      freeText: 'Dinner at the camp',
      userId: 'u_member',
    })
    expect(id).toBeTypeOf('string')
  })

  it('rejects grounding on a draft/missing Experience', async () => {
    await expect(
      addItinerarySlot(db, {
        groupId,
        dayOffset: 0,
        timeBand: 'morning',
        experienceId: draftExpId,
        userId: 'u_host',
      }),
    ).rejects.toMatchObject({ code: 'EXPERIENCE_NOT_GROUNDED' })
    await expect(
      addItinerarySlot(db, {
        groupId,
        dayOffset: 0,
        timeBand: 'morning',
        experienceId: '00000000-0000-0000-0000-000000000000',
        userId: 'u_host',
      }),
    ).rejects.toMatchObject({ code: 'EXPERIENCE_NOT_GROUNDED' })
  })

  it('rejects an empty slot (no experience + no free text)', async () => {
    await expect(
      addItinerarySlot(db, { groupId, dayOffset: 0, timeBand: 'morning', userId: 'u_host' }),
    ).rejects.toMatchObject({ code: 'INVALID_INPUT' })
  })

  it('last-write-wins: a second writer overwrites content + records itself', async () => {
    const { id } = await addItinerarySlot(db, {
      groupId,
      dayOffset: 0,
      timeBand: 'morning',
      freeText: 'first plan',
      userId: 'u_host',
    })
    await updateItinerarySlot(db, { slotId: id, freeText: 'second plan', userId: 'u_member' })
    const [slot] = await db
      .select()
      .from(tripGroupItinerarySlots)
      .where(eq(tripGroupItinerarySlots.id, id))
    expect(slot?.freeText).toBe('second plan')
    expect(slot?.updatedByUserId).toBe('u_member')
  })

  it('update re-validates grounding (cannot point a slot at a draft)', async () => {
    const { id } = await addItinerarySlot(db, {
      groupId,
      dayOffset: 0,
      timeBand: 'morning',
      experienceId: publishedExpId,
      userId: 'u_host',
    })
    await expect(
      updateItinerarySlot(db, { slotId: id, experienceId: draftExpId, userId: 'u_member' }),
    ).rejects.toMatchObject({ code: 'EXPERIENCE_NOT_GROUNDED' })
  })

  it('lists slots ordered by day then sort order; delete removes one', async () => {
    const a = await addItinerarySlot(db, { groupId, dayOffset: 1, timeBand: 'am', freeText: 'd1', sortOrder: 0, userId: 'u_host' })
    await addItinerarySlot(db, { groupId, dayOffset: 0, timeBand: 'am', freeText: 'd0a', sortOrder: 0, userId: 'u_host' })
    await addItinerarySlot(db, { groupId, dayOffset: 0, timeBand: 'pm', freeText: 'd0b', sortOrder: 1, userId: 'u_host' })
    const ordered = await listItinerary(db, groupId)
    expect(ordered.map((s) => s.freeText)).toEqual(['d0a', 'd0b', 'd1'])
    await deleteItinerarySlot(db, a.id)
    expect((await listItinerary(db, groupId)).map((s) => s.freeText)).toEqual(['d0a', 'd0b'])
  })
})
