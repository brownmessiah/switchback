/**
 * `/community` discovery query (ADR-0009). Lists PUBLIC, still-joinable
 * TripGroups (visibility public_all | public_women_only; status forming |
 * planning) with intent filters. The "women-verified hosts only" filter joins
 * the host's `aadhaar_gender_verified` in the WHERE clause ONLY — gender is
 * NEVER selected into the output (privacy, ADR-0009). Private groups are never
 * discoverable.
 */

import { and, count, eq, gte, inArray, lte, sql } from 'drizzle-orm'

import { customerProfiles } from '@/db/schema/customer-profiles'
import { tripGroupMembers, tripGroups } from '@/db/schema/trip-groups'
import type { DBOrTx } from '@/lib/payments/commission-resolver'

export interface DiscoveryFilters {
  destinationSlug?: string
  interestTag?: string
  womenVerifiedHostsOnly?: boolean
  /** Overlap window: groups whose target window intersects [from, to]. */
  dateWindowFrom?: string
  dateWindowTo?: string
  limit?: number
  offset?: number
}

/** A public group card — DELIBERATELY no host gender / identity beyond name. */
export interface DiscoveryGroupCard {
  id: string
  name: string
  destinationSlugs: string[]
  interestTags: string[]
  targetDateWindowStart: string | null
  targetDateWindowEnd: string | null
  visibility: 'public_all' | 'public_women_only'
  status: 'forming' | 'planning'
  maxMembers: number
  activeMemberCount: number
}

export async function listPublicGroups(
  db: DBOrTx,
  filters: DiscoveryFilters = {},
): Promise<DiscoveryGroupCard[]> {
  const limit = Math.min(Math.max(filters.limit ?? 24, 1), 100)
  const offset = Math.max(filters.offset ?? 0, 0)

  const conditions = [
    inArray(tripGroups.visibility, ['public_all', 'public_women_only'] as const),
    inArray(tripGroups.status, ['forming', 'planning'] as const),
  ]
  if (filters.destinationSlug) {
    conditions.push(sql`${filters.destinationSlug} = ANY(${tripGroups.destinationSlugs})`)
  }
  if (filters.interestTag) {
    conditions.push(sql`${filters.interestTag} = ANY(${tripGroups.interestTags})`)
  }
  // Window overlap: group.start <= filterTo AND group.end >= filterFrom.
  if (filters.dateWindowTo) {
    conditions.push(lte(tripGroups.targetDateWindowStart, filters.dateWindowTo))
  }
  if (filters.dateWindowFrom) {
    conditions.push(gte(tripGroups.targetDateWindowEnd, filters.dateWindowFrom))
  }
  if (filters.womenVerifiedHostsOnly) {
    // Host must be Aadhaar-verified female — gender used ONLY in the filter,
    // never selected. Correct-but-inert until eKYC populates the flag.
    conditions.push(
      sql`EXISTS (SELECT 1 FROM ${customerProfiles} cp WHERE cp.user_id = ${tripGroups.hostUserId} AND cp.aadhaar_gender_verified = 'female')`,
    )
  }

  const rows = await db
    .select({
      id: tripGroups.id,
      name: tripGroups.name,
      destinationSlugs: tripGroups.destinationSlugs,
      interestTags: tripGroups.interestTags,
      targetDateWindowStart: tripGroups.targetDateWindowStart,
      targetDateWindowEnd: tripGroups.targetDateWindowEnd,
      visibility: tripGroups.visibility,
      status: tripGroups.status,
      maxMembers: tripGroups.maxMembers,
      activeMemberCount: count(tripGroupMembers.userId),
    })
    .from(tripGroups)
    .leftJoin(
      tripGroupMembers,
      and(
        eq(tripGroupMembers.tripGroupId, tripGroups.id),
        eq(tripGroupMembers.status, 'active'),
      ),
    )
    .where(and(...conditions))
    .groupBy(tripGroups.id)
    .orderBy(tripGroups.createdAt)
    .limit(limit)
    .offset(offset)

  // Narrow the enum types for the card (filtered to public + joinable above).
  return rows.map((r) => ({
    ...r,
    visibility: r.visibility as 'public_all' | 'public_women_only',
    status: r.status as 'forming' | 'planning',
  }))
}
