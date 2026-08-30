/**
 * TripGroup demo seed (ADR-0009 / issue #20). Isolation-safe: uses its OWN
 * dedicated fixture users (never the money-determinism customers asserted by
 * #13–#15 / the admin queues), and only seeds when no demo group exists yet so
 * a dev re-seed stays idempotent. Populates `/community` with a public group, a
 * women-only group, and a host-approval group — each with a host, a joiner, and
 * an itinerary grounded on a real published Experience.
 */

import { eq, sql } from 'drizzle-orm'

import { db as defaultDb } from '@/db/client'
import { customerProfiles } from '@/db/schema/customer-profiles'
import { experiences } from '@/db/schema/experiences'
import { tripGroups } from '@/db/schema/trip-groups'
import { users } from '@/db/schema/users'
import type { DB } from '@/db/client'
import { addItinerarySlot } from '@/lib/trip-groups/itinerary'
import { createTripGroup } from '@/lib/trip-groups/groups'
import { requestToJoin } from '@/lib/trip-groups/membership'

const TG_HOST = 'u_tg_host'
const TG_HOST_FEMALE = 'u_tg_host_f'
const TG_MEMBER = 'u_tg_member'

export async function seedTripGroups(db: DB = defaultDb): Promise<void> {
  // Idempotency guard — skip if the demo host already owns a group.
  const existing = await db
    .select({ id: tripGroups.id })
    .from(tripGroups)
    .where(eq(tripGroups.hostUserId, TG_HOST))
    .limit(1)
  if (existing.length > 0) return

  await db
    .insert(users)
    .values([
      { id: TG_HOST, email: 'tg-host@seed.switchback.dev', name: 'Aarav (host)' },
      { id: TG_HOST_FEMALE, email: 'tg-host-f@seed.switchback.dev', name: 'Diya (host)' },
      { id: TG_MEMBER, email: 'tg-member@seed.switchback.dev', name: 'Kabir' },
    ])
    .onConflictDoNothing()

  await db
    .insert(customerProfiles)
    .values([
      { userId: TG_HOST, aadhaarGenderVerified: 'male' },
      { userId: TG_HOST_FEMALE, aadhaarGenderVerified: 'female' },
      { userId: TG_MEMBER, aadhaarGenderVerified: 'unverified' },
    ])
    .onConflictDoNothing()

  // Two published experiences to ground itinerary slots on.
  const published = await db
    .select({ id: experiences.id })
    .from(experiences)
    .where(eq(experiences.status, 'published'))
    .limit(2)
  const expA = published[0]?.id
  const expB = published[1]?.id ?? expA

  // 1. Public, auto-accept group — host + one joiner (→ planning), 2-slot plan.
  const open = await createTripGroup(db, {
    hostUserId: TG_HOST,
    name: 'Rishikesh rafting weekend',
    maxMembers: 6,
    destinationSlugs: ['rishikesh'],
    interestTags: ['rafting', 'camping'],
    visibility: 'public_all',
    membershipRule: 'auto_accept',
  })
  await requestToJoin(db, { groupId: open.id, userId: TG_MEMBER })
  if (expA) {
    await addItinerarySlot(db, {
      groupId: open.id,
      dayOffset: 0,
      timeBand: 'morning',
      experienceId: expA,
      userId: TG_HOST,
    })
  }
  await addItinerarySlot(db, {
    groupId: open.id,
    dayOffset: 0,
    timeBand: 'evening',
    freeText: 'Riverside camp + bonfire',
    userId: TG_MEMBER,
  })

  // 2. Women-only group hosted by a verified-female host.
  await createTripGroup(db, {
    hostUserId: TG_HOST_FEMALE,
    name: 'Goa girls’ dive trip',
    maxMembers: 5,
    destinationSlugs: ['goa'],
    interestTags: ['scuba'],
    visibility: 'public_women_only',
    membershipRule: 'auto_accept',
  })

  // 3. Host-approval group (shows the pending-request flow).
  const approval = await createTripGroup(db, {
    hostUserId: TG_HOST,
    name: 'Manali trek (curated)',
    maxMembers: 8,
    destinationSlugs: ['manali'],
    interestTags: ['trekking'],
    visibility: 'public_all',
    membershipRule: 'host_approval',
  })
  if (expB) {
    await addItinerarySlot(db, {
      groupId: approval.id,
      dayOffset: 1,
      timeBand: 'morning',
      experienceId: expB,
      userId: TG_HOST,
    })
  }
  await db
    .update(tripGroups)
    .set({ updatedAt: sql`now()` })
    .where(eq(tripGroups.id, approval.id))
}
