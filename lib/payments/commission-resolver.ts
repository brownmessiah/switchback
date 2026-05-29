import { and, eq, gt, lte, sql, type ExtractTablesWithRelations } from 'drizzle-orm'
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core'

import * as schema from '@/db/schema'
import { commissionTiers } from '@/db/schema/commission-tiers'
import { experiences } from '@/db/schema/experiences'
import { vendorProfiles } from '@/db/schema/vendor-profiles'

/**
 * Platform default commission rate per ADR-0008. Constant so the
 * booking-create transaction has a defensible fallback even if the
 * vendor row goes missing under a future schema change.
 */
export const PLATFORM_DEFAULT_COMMISSION_RATE = '20.00'

/**
 * Resolution result snapshotted onto bookings.commission_rate_snapshot +
 * commission_basis_snapshot at Booking-create.
 *
 * `rate` is a numeric(5,2) as a string — never use JS floating point on
 * money. `basis` is the audit label identifying which layer of the chain
 * fired (`festival:<tier_name>`, `experience_override`, `vendor_default`,
 * or `platform_default`).
 */
export interface ResolvedCommission {
  rate: string
  basis: string
}

/**
 * Drizzle's transaction handle is the same shape as the top-level db
 * handle for query purposes. We accept either so booking-create can
 * call the resolver inside its single db.transaction(...). We also
 * accept the PGlite handle from the test harness — both extend the
 * PgDatabase base type from drizzle-orm/pg-core.
 */
export type DBOrTx = PgDatabase<
  PgQueryResultHKT,
  typeof schema,
  ExtractTablesWithRelations<typeof schema>
>

interface ResolveCommissionArgs {
  experienceId: string
  now?: Date
}

/**
 * Resolve the commission rate that applies to a Booking on the given
 * Experience as of `now` (defaults to the current wall clock). Returns
 * the first non-null arm of the chain per ADR-0008:
 *
 *   1. Active festival tier (commission_tiers; most-recently-created
 *      among matches; scope-filtered by category/vendor/experience).
 *   2. Per-Experience override (experiences.commission_rate_override).
 *   3. Per-Vendor base rate (vendor_profiles.commission_rate).
 *   4. Platform default constant.
 *
 * Snapshot rule: this function is called once at Booking-create inside
 * the db.transaction. The result is written to bookings.commission_*_
 * snapshot columns and never recomputed for that Booking — the UPDATE
 * trigger from migration 0004 enforces that structurally.
 */
export async function resolveCommission(
  db: DBOrTx,
  args: ResolveCommissionArgs,
): Promise<ResolvedCommission> {
  const now = args.now ?? new Date()

  const [exp] = await db
    .select({
      id: experiences.id,
      vendorUserId: experiences.vendorUserId,
      activitySlug: experiences.activitySlug,
      commissionRateOverride: experiences.commissionRateOverride,
    })
    .from(experiences)
    .where(eq(experiences.id, args.experienceId))
    .limit(1)

  if (!exp) {
    throw new Error(`Experience ${args.experienceId} not found`)
  }

  // 1. Festival tier — most recently created matching tier wins.
  //
  // Scope semantics per ADR-0008: empty applies_to_* array means
  // "unconstrained on that dimension" (matches all). Postgres returns
  // NULL for array_length(empty_array, 1), so the predicate is
  // "length IS NULL OR value = ANY(array)".
  const matchingTiers = await db
    .select({
      name: commissionTiers.name,
      rateOverride: commissionTiers.rateOverride,
    })
    .from(commissionTiers)
    .where(
      and(
        lte(commissionTiers.startAt, now),
        // `gt` (not raw `sql`) so the Date binds as the column type — a raw
        // interpolation passes a JS Date to postgres-js and throws
        // ERR_INVALID_ARG_TYPE on the real driver (PGlite tolerates it).
        // Same money-path defect class as pricing-resolver. (Issue #13)
        gt(commissionTiers.endAt, now),
        sql`(
          array_length(${commissionTiers.appliesToCategories}, 1) IS NULL
          OR ${exp.activitySlug} = ANY(${commissionTiers.appliesToCategories})
        )`,
        sql`(
          array_length(${commissionTiers.appliesToVendorIds}, 1) IS NULL
          OR ${exp.vendorUserId} = ANY(${commissionTiers.appliesToVendorIds})
        )`,
        sql`(
          array_length(${commissionTiers.appliesToExperienceIds}, 1) IS NULL
          OR ${exp.id}::uuid = ANY(${commissionTiers.appliesToExperienceIds})
        )`,
      ),
    )
    .orderBy(sql`${commissionTiers.createdAt} DESC`)
    .limit(1)

  if (matchingTiers.length) {
    const tier = matchingTiers[0]!
    return { rate: tier.rateOverride, basis: `festival:${tier.name}` }
  }

  // 2. Per-Experience override.
  if (exp.commissionRateOverride !== null) {
    return { rate: exp.commissionRateOverride, basis: 'experience_override' }
  }

  // 3. Per-Vendor base rate.
  const [vendor] = await db
    .select({ rate: vendorProfiles.commissionRate })
    .from(vendorProfiles)
    .where(eq(vendorProfiles.userId, exp.vendorUserId))
    .limit(1)

  if (vendor) {
    return { rate: vendor.rate, basis: 'vendor_default' }
  }

  // 4. Platform default. Unreachable while the experiences.vendor_user_id
  // FK is NOT NULL, but the arm exists as a defensive fallback so a
  // future schema change (e.g. an inactive Vendor row hidden from joins)
  // cannot cause a silent missing-rate bug.
  return { rate: PLATFORM_DEFAULT_COMMISSION_RATE, basis: 'platform_default' }
}
