/**
 * Purge planner (launch-readiness 05) — the read-only half.
 *
 * Splitting planning from execution is the point: the dry-run and the
 * real run consume the SAME plan structure, so what the operator
 * approves is exactly what runs, rather than an approximation of it.
 *
 * ── Traversal, not per-table predicates ─────────────────────────────
 * Seeded Experiences and base-seed Bookings carry no marker — every
 * insert omits `id` and takes gen_random_uuid(). They are identifiable
 * ONLY transitively, via their owning User. So the plan is rooted at the
 * set of seeded User ids (by email domain) and walks outward, with a
 * separate content-keyed pass for the tables that have no FK to users at
 * all.
 *
 * ── The referential pre-flight ──────────────────────────────────────
 * The catastrophic failure mode is not "targets a real row" — it is a
 * REAL row pointing AT a targeted row:
 *   bookings.experience_id  RESTRICT → aborts the transaction, after the
 *                                      operator already approved counts
 *   reviews.experience_id   CASCADE  → silently destroys a real
 *                                      Customer's Review, absent from
 *                                      the plan entirely
 *   cart_items.experience_id CASCADE → same, for a real Customer's cart
 * The planner enumerates these and refuses (`safeToExecute: false`)
 * rather than deleting or cascading through them.
 */

import { and, eq, inArray, notInArray, sql, type SQL } from 'drizzle-orm'

import { bookings } from '@/db/schema/bookings'
import { cartItems, carts } from '@/db/schema/carts'
import { experiences } from '@/db/schema/experiences'
import { reviews } from '@/db/schema/reviews'
import { users } from '@/db/schema/users'
import type { DBOrTx } from '@/lib/payments/commission-resolver'

import { PURGE_TABLE_ORDER } from './purge-order'
import {
  SEED_ADMIN_USER_ID,
  SEED_EMAIL_DOMAIN,
  SEED_MEDIA_KEY_PREFIX,
  SEEDED_COMMISSION_TIER_NAMES,
  SEEDED_PRICING_TIER_NAMES,
  SEEDED_PROMO_CODES,
  SEEDED_REGION_CLOSURE_REGIONS,
} from './seed-data-registry'

export interface PurgePlanEntry {
  table: string
  rowCount: number
  /** Why these rows qualify — rendered in the dry-run for the operator. */
  reason: string
  /** SQL predicate applied to this table, for the operational record. */
  predicate: string
}

export interface PurgeBlocker {
  table: string
  column: string
  rowCount: number
  onDelete: 'RESTRICT' | 'CASCADE'
  consequence: string
  sampleIds: string[]
}

export interface PurgeExclusion {
  table: string
  reason: string
}

/**
 * How execution should delete a table's rows. The plan carries these so
 * slice 06 applies exactly what the dry-run counted, rather than
 * re-evaluating a predicate against a database that may have changed.
 */
export type DeleteTarget =
  | { kind: 'ids'; ids: string[] }
  | { kind: 'column-in'; column: string; values: string[] }
  | { kind: 'like'; column: string; pattern: string }
  /**
   * Traversal tables: the exact column -> seeded-id clauses the planner
   * COUNTED with, OR'd together. Carried rather than re-derived so the
   * delete predicate is identical to the count predicate by
   * construction. Also the only workable form for tables with no `id`
   * column (e.g. trip_group_members has a composite primary key).
   */
  | { kind: 'root-columns'; clauses: Array<{ column: string; ids: string[] }> }

/** Seeded id sets, expanded level by level from the User roots. */
export interface SeedRoots {
  users: string[]
  experiences: string[]
  bookings: string[]
  reviews: string[]
  conversations: string[]
  notifications: string[]
  supportTickets: string[]
  tripGroups: string[]
  carts: string[]
  refundRequests: string[]
  promoCodes: string[]
  availabilitySlots: string[]
  orders: string[]
}

function unique(values: string[]): string[] {
  return [...new Set(values)]
}

export interface PurgePlan {
  entries: PurgePlanEntry[]
  blockers: PurgeBlocker[]
  exclusions: PurgeExclusion[]
  totalRows: number
  /** False whenever any blocker exists. Execution must honour this. */
  safeToExecute: boolean
  seedUserIds: string[]
  seedExperienceIds: string[]
  /** Per-table delete instructions, consumed verbatim by slice 06. */
  deleteTargets: Record<string, DeleteTarget>
}

/** `email ILIKE '%@seed.outvers.dev'` — NULL-safe, so phone-only Users never match. */
const seedEmailPredicate = sql`lower(${users.email}) LIKE ${'%' + SEED_EMAIL_DOMAIN}`

export async function buildPurgePlan(db: DBOrTx): Promise<PurgePlan> {
  // ── Roots: seeded Users, minus the Admin we deliberately keep ──────
  const seedUserRows = await db
    .select({ id: users.id })
    .from(users)
    .where(and(seedEmailPredicate, sql`${users.id} <> ${SEED_ADMIN_USER_ID}`))
  const seedUserIds = seedUserRows.map((r) => r.id)

  const exclusions: PurgeExclusion[] = [
    {
      table: 'users',
      reason:
        `the seeded admin (${SEED_ADMIN_USER_ID}) is preserved: it is the only ` +
        'route into /admin and may author the blog corpus via a restrict FK. ' +
        'Slice 07 converts it in place rather than deleting it.',
    },
    {
      table: 'blog_posts',
      reason: 'the 40-post SEO corpus is never purged',
    },
  ]

  // ── Experiences owned by seeded Vendors ────────────────────────────
  const seedExperienceIds =
    seedUserIds.length > 0
      ? (
          await db
            .select({ id: experiences.id })
            .from(experiences)
            .where(inArray(experiences.vendorUserId, seedUserIds))
        ).map((r) => r.id)
      : []

  // ── Referential pre-flight ─────────────────────────────────────────
  const blockers: PurgeBlocker[] = []

  if (seedExperienceIds.length > 0) {
    const realBookings =
      seedUserIds.length > 0
        ? await db
            .select({ id: bookings.id })
            .from(bookings)
            .where(
              and(
                inArray(bookings.experienceId, seedExperienceIds),
                notInArray(bookings.customerUserId, seedUserIds),
              ),
            )
        : await db
            .select({ id: bookings.id })
            .from(bookings)
            .where(inArray(bookings.experienceId, seedExperienceIds))

    if (realBookings.length > 0) {
      blockers.push({
        table: 'bookings',
        column: 'experience_id',
        rowCount: realBookings.length,
        onDelete: 'RESTRICT',
        consequence:
          'A real Customer booked a seeded Experience. bookings.experience_id ' +
          'is RESTRICT, so deleting that Experience raises and rolls back the ' +
          'entire purge — after the counts were approved. Resolve these ' +
          'Bookings before purging.',
        sampleIds: realBookings.slice(0, 10).map((r) => r.id),
      })
    }

    const realReviews =
      seedUserIds.length > 0
        ? await db
            .select({ id: reviews.id })
            .from(reviews)
            .where(
              and(
                inArray(reviews.experienceId, seedExperienceIds),
                notInArray(reviews.customerUserId, seedUserIds),
              ),
            )
        : await db
            .select({ id: reviews.id })
            .from(reviews)
            .where(inArray(reviews.experienceId, seedExperienceIds))

    if (realReviews.length > 0) {
      blockers.push({
        table: 'reviews',
        column: 'experience_id',
        rowCount: realReviews.length,
        onDelete: 'CASCADE',
        consequence:
          'A real Customer reviewed a seeded Experience. reviews.experience_id ' +
          'is CASCADE, so the purge would SILENTLY DESTROY their Review with no ' +
          'row in the plan. Irreversible.',
        sampleIds: realReviews.slice(0, 10).map((r) => r.id),
      })
    }

    // A cart item's owner is reached through its cart, so the "is this
    // real?" test is on carts.customer_user_id, not on the item.
    const realCartItems = await db
      .select({ id: cartItems.id })
      .from(cartItems)
      .innerJoin(carts, eq(carts.id, cartItems.cartId))
      .where(
        seedUserIds.length > 0
          ? and(
              inArray(cartItems.experienceId, seedExperienceIds),
              notInArray(carts.customerUserId, seedUserIds),
            )
          : inArray(cartItems.experienceId, seedExperienceIds),
      )

    if (realCartItems.length > 0) {
      blockers.push({
        table: 'cart_items',
        column: 'experience_id',
        rowCount: realCartItems.length,
        onDelete: 'CASCADE',
        consequence:
          "A real Customer's cart holds a seeded Experience. " +
          'cart_items.experience_id is CASCADE, so the purge would silently ' +
          'empty their cart.',
        sampleIds: realCartItems.slice(0, 10).map((r) => r.id),
      })
    }
  }

  // ── Expand the roots outward, level by level ───────────────────────
  // Each level becomes a root for the next: bookings hang off users AND
  // experiences, payments hang off bookings, notification_outbox hangs
  // off notifications. A single-level (user/experience) probe silently
  // reports zero for every one of those tables.
  const roots: SeedRoots = {
    users: seedUserIds,
    experiences: seedExperienceIds,
    bookings: [],
    reviews: [],
    conversations: [],
    notifications: [],
    supportTickets: [],
    tripGroups: [],
    carts: [],
    refundRequests: [],
    promoCodes: [],
    availabilitySlots: [],
    orders: [],
  }

  if (seedUserIds.length > 0 || seedExperienceIds.length > 0) {
    roots.availabilitySlots = await collectIds(db, 'availability_slots', roots)
    roots.carts = await collectIds(db, 'carts', roots)
    roots.tripGroups = await collectIds(db, 'trip_groups', roots)
    roots.orders = await collectIds(db, 'orders', roots)
    roots.bookings = await collectIds(db, 'bookings', roots)
    // Second pass: orders/payouts reference bookings and vice versa.
    roots.orders = unique([...roots.orders, ...(await collectIds(db, 'orders', roots))])
    roots.refundRequests = await collectIds(db, 'refund_requests', roots)
    roots.reviews = await collectIds(db, 'reviews', roots)
    roots.conversations = await collectIds(db, 'conversations', roots)
    roots.notifications = await collectIds(db, 'notifications', roots)
    roots.supportTickets = await collectIds(db, 'support_tickets', roots)
    roots.promoCodes = await collectSeededPromoCodeIds(db)
  }

  // ── Counts, in FK-safe order ───────────────────────────────────────
  const entries: PurgePlanEntry[] = []

  const deleteTargets: Record<string, DeleteTarget> = {}

  for (const table of PURGE_TABLE_ORDER) {
    let rowCount = 0
    let reason = 'reachable from a seeded User'
    let predicate = 'transitive from seeded users'

    if (table === 'users') {
      rowCount = seedUserIds.length
      reason = `Users whose email ends ${SEED_EMAIL_DOMAIN}, excluding the preserved admin`
      predicate = `lower(email) LIKE '%${SEED_EMAIL_DOMAIN}' AND id <> '${SEED_ADMIN_USER_ID}'`
      deleteTargets[table] = { kind: 'ids', ids: seedUserIds }
    } else if (table === 'experiences') {
      rowCount = seedExperienceIds.length
      reason = 'Experiences owned by a seeded Vendor'
      predicate = 'vendor_user_id IN (seeded users)'
      deleteTargets[table] = { kind: 'ids', ids: seedExperienceIds }
    } else if (table === 'promo_codes') {
      rowCount = await countByColumnIn(db, 'promo_codes', 'code', SEEDED_PROMO_CODES)
      reason = 'seeded promo codes — redeemable by any Customer, no ownership check'
      predicate = `code IN (${SEEDED_PROMO_CODES.join(', ')})`
      deleteTargets[table] = { kind: 'column-in', column: 'code', values: [...SEEDED_PROMO_CODES] }
    } else if (table === 'region_closures') {
      rowCount = await countByColumnIn(db, 'region_closures', 'region_slug', SEEDED_REGION_CLOSURE_REGIONS)
      reason = 'seeded region closures — they suppress slot materialisation for real Vendors'
      predicate = `region_slug IN (${SEEDED_REGION_CLOSURE_REGIONS.join(', ')})`
      deleteTargets[table] = {
        kind: 'column-in',
        column: 'region_slug',
        values: [...SEEDED_REGION_CLOSURE_REGIONS],
      }
    } else if (table === 'commission_tiers' || table === 'pricing_tiers') {
      const names =
        table === 'commission_tiers'
          ? [...SEEDED_COMMISSION_TIER_NAMES]
          : [...SEEDED_PRICING_TIER_NAMES]
      rowCount = await countByColumnIn(db, table, 'name', names)
      reason = 'seeded tier overrides scoped to catalog Experiences'
      predicate = `name IN (${names.join(', ')})`
      deleteTargets[table] = { kind: 'column-in', column: 'name', values: names }
    } else if (table === 'media_assets') {
      rowCount = await countSeedMedia(db)
      reason = `media whose storage_key starts '${SEED_MEDIA_KEY_PREFIX}' (Unsplash hotlinks, no bucket object)`
      predicate = `storage_key LIKE '${SEED_MEDIA_KEY_PREFIX}%'`
      deleteTargets[table] = {
        kind: 'like',
        column: 'storage_key',
        pattern: `${SEED_MEDIA_KEY_PREFIX}%`,
      }
    } else {
      const columns = await tableColumns(db, table)
      const clauses = resolveColumnRoots(columns, roots)
        .filter(([, ids]) => ids.length > 0)
        .map(([column, ids]) => ({ column, ids }))
      rowCount = await countTransitive(db, table, roots)
      deleteTargets[table] = { kind: 'root-columns', clauses }
    }

    entries.push({ table, rowCount, reason, predicate })
  }

  const totalRows = entries.reduce((sum, e) => sum + e.rowCount, 0)

  return {
    entries,
    blockers,
    exclusions,
    totalRows,
    safeToExecute: blockers.length === 0,
    seedUserIds,
    seedExperienceIds,
    deleteTargets,
  }
}

/** Count rows in `table` whose `column` is one of `values`. */
async function countByColumnIn(
  db: DBOrTx,
  table: string,
  column: string,
  values: readonly string[],
): Promise<number> {
  if (values.length === 0) return 0
  const result = await db.execute(
    sql`SELECT count(*)::int AS total FROM ${sql.identifier(table)}
        WHERE ${sql.identifier(column)} = ANY(${sql.param([...values])})`,
  )
  return readCount(result)
}

async function countSeedMedia(db: DBOrTx): Promise<number> {
  const result = await db.execute(
    sql`SELECT count(*)::int AS total FROM "media_assets"
        WHERE storage_key LIKE ${SEED_MEDIA_KEY_PREFIX + '%'}`,
  )
  return readCount(result)
}

/**
 * Count rows in `table` reachable from the seeded roots.
 *
 * Resolved by probing the LIVE catalog for user- or experience-shaped FK
 * columns rather than a hardcoded per-table map, so a table gained by a
 * future migration is counted rather than silently skipped — the failure
 * mode where a dry-run under-reports and the operator approves a purge
 * that touches more than they were shown.
 */
async function countTransitive(
  db: DBOrTx,
  table: string,
  roots: SeedRoots,
): Promise<number> {
  const columns = await tableColumns(db, table)
  const clauses: SQL[] = []

  for (const [column, ids] of resolveColumnRoots(columns, roots)) {
    if (ids.length === 0) continue
    clauses.push(sql`${sql.identifier(column)} = ANY(${sql.param(ids)})`)
  }

  if (clauses.length === 0) return 0

  const result = await db.execute(
    sql`SELECT count(*)::int AS total FROM ${sql.identifier(table)}
        WHERE ${sql.join(clauses, sql` OR `)}`,
  )
  return readCount(result)
}

/**
 * Map a table's columns onto the seeded id sets they reference.
 *
 * A user/experience-only mapping is NOT enough, and the omission is
 * dangerous rather than cosmetic: `payments` carries no user or
 * experience column — it hangs off `booking_id` — so a user-only probe
 * reports ZERO payments while `payments.booking_id` is RESTRICT. The
 * dry-run would under-report and execution would abort mid-transaction,
 * after the operator approved the counts. Same shape for
 * notification_outbox (notification_id) and review_photos (review_id).
 */
function resolveColumnRoots(
  columns: string[],
  roots: SeedRoots,
): Array<[string, string[]]> {
  const pairs: Array<[string, string[]]> = []

  for (const column of columns) {
    if (column.endsWith('_user_id') || column === 'user_id' || column === 'uploaded_by') {
      pairs.push([column, roots.users])
    } else if (column === 'experience_id') {
      pairs.push([column, roots.experiences])
    } else if (column === 'booking_id') {
      pairs.push([column, roots.bookings])
    } else if (column === 'review_id') {
      pairs.push([column, roots.reviews])
    } else if (column === 'conversation_id') {
      pairs.push([column, roots.conversations])
    } else if (column === 'notification_id') {
      pairs.push([column, roots.notifications])
    } else if (column === 'ticket_id') {
      pairs.push([column, roots.supportTickets])
    } else if (column === 'trip_group_id') {
      pairs.push([column, roots.tripGroups])
    } else if (column === 'cart_id') {
      pairs.push([column, roots.carts])
    } else if (column === 'refund_request_id') {
      pairs.push([column, roots.refundRequests])
    } else if (column === 'promo_code_id') {
      pairs.push([column, roots.promoCodes])
    } else if (column === 'slot_id') {
      pairs.push([column, roots.availabilitySlots])
    } else if (column === 'order_id') {
      pairs.push([column, roots.orders])
    }
  }

  return pairs
}

/** Collect the ids of every seed row in `table`, for use as a further root. */
async function collectIds(
  db: DBOrTx,
  table: string,
  roots: SeedRoots,
): Promise<string[]> {
  const columns = await tableColumns(db, table)
  const clauses: SQL[] = []

  for (const [column, ids] of resolveColumnRoots(columns, roots)) {
    if (ids.length === 0) continue
    clauses.push(sql`${sql.identifier(column)} = ANY(${sql.param(ids)})`)
  }
  if (clauses.length === 0) return []

  const result = await db.execute(
    sql`SELECT id FROM ${sql.identifier(table)} WHERE ${sql.join(clauses, sql` OR `)}`,
  )
  const rows =
    (result as unknown as { rows?: { id: string }[] }).rows ??
    (result as unknown as { id: string }[])
  return rows.map((r) => String(r.id))
}

const columnCache = new Map<string, string[]>()

async function tableColumns(db: DBOrTx, table: string): Promise<string[]> {
  const cached = columnCache.get(table)
  if (cached) return cached
  const result = await db.execute(
    sql`SELECT column_name FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = ${table}`,
  )
  const rows =
    (result as unknown as { rows?: { column_name: string }[] }).rows ??
    (result as unknown as { column_name: string }[])
  const cols = rows.map((r) => r.column_name)
  columnCache.set(table, cols)
  return cols
}

function readCount(result: unknown): number {
  const rows =
    (result as { rows?: { total: number }[] }).rows ??
    (result as unknown as { total: number }[])
  return Number(rows?.[0]?.total ?? 0)
}

/** Seeded promo codes are content-keyed, not reachable by traversal. */
async function collectSeededPromoCodeIds(db: DBOrTx): Promise<string[]> {
  const result = await db.execute(
    sql`SELECT id FROM "promo_codes" WHERE code = ANY(${sql.param([...SEEDED_PROMO_CODES])})`,
  )
  const rows =
    (result as unknown as { rows?: { id: string }[] }).rows ??
    (result as unknown as { id: string }[])
  return rows.map((r) => String(r.id))
}
