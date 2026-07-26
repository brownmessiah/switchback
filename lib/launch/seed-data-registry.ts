/**
 * Seed-data registry (launch-readiness 05) — the single source of truth
 * for what qualifies as demo data on production. Every consumer (purge
 * planner, execution, verification) asks this module rather than
 * re-encoding the convention, so changing the definition of "seed data"
 * is a one-line change in one file.
 *
 * ── Why the EMAIL is the primary predicate ──────────────────────────
 * The PRD stated seeded Users carry both an `@seed.outvers.dev` email
 * and a `u_seed_` id prefix, as though either identified them. Only the
 * email holds. FIVE distinct id prefixes exist across the seed modules
 * and `u_seed_` matches roughly a third of them, so a registry keyed on
 * the prefix would leave ~99 seeded Users — and every Experience,
 * Booking, Review and wallet row hanging off them — alive on production
 * while the dry-run counts looked entirely plausible.
 *
 * The prefixes are kept as a documented SET for corroboration and
 * reporting, never as the deletion predicate.
 *
 * ── Why non-User tables are not listed here ─────────────────────────
 * Seeded Experiences and base-seed Bookings carry NO marker at all —
 * every insert omits `id` and takes `gen_random_uuid()`. They are
 * reachable only transitively, via their owning User. That is why the
 * planner is a traversal rooted at seeded Users rather than a set of
 * per-table predicates. `media_assets` is the one exception: its
 * storage keys are prefixed, and real uploads must be spared because
 * they own a live object in the public GCS bucket.
 *
 * ── Content-keyed rows ──────────────────────────────────────────────
 * Some seeded tables have no FK to `users` at all, or a SET NULL edge,
 * so deleting every seeded User leaves them behind. Two are live
 * hazards after launch and are enumerated below by natural key.
 */

/** The domain every seed module stamps on the Users it creates. */
export const SEED_EMAIL_DOMAIN = '@seed.outvers.dev'

/** Storage-key prefix used by every seeded media asset. */
export const SEED_MEDIA_KEY_PREFIX = 'seed/'

/**
 * Every User id prefix minted by a seed module. Corroboration only —
 * `isSeedEmail` is the predicate that decides deletion.
 *   u_seed_*      db/seed.ts
 *   u_cat_*       db/seed-extras.ts, db/data/demo-catalog.ts
 *   u_enr_cust_*  db/seed-extras.ts
 *   u_demo_cust_* db/seed-demo-catalog.ts
 *   u_tg_*        db/seed-trip-groups.ts
 */
export const SEED_USER_ID_PREFIXES = [
  'u_seed_',
  'u_cat_',
  'u_enr_cust_',
  'u_demo_cust_',
  'u_tg_',
] as const

/** The full-permission seeded Admin that slice 07 converts in place. */
export const SEED_ADMIN_USER_ID = 'u_seed_admin'

/**
 * Seeded promo codes. `promo_codes.created_by_admin_id` is SET NULL, so
 * these survive every seeded-User delete, and `redeemPromo` looks a code
 * up by `code` alone with no ownership check — leaving them live means
 * any real Customer who is told one gets free wallet credit.
 */
export const SEEDED_PROMO_CODES = [
  'WELCOME500',
  'MONSOON15',
  'FIRSTBOOKING',
  'DIWALI2026',
  'REFER300',
  'SUMMER10',
  'LADAKH2000',
] as const

/**
 * Seeded region closures (natural key: region_slug + reason). No FK of
 * any kind. The slot materializer filters by overlapping closure, so
 * leaving these means a real Vendor listing in one of these regions gets
 * a silently empty calendar and cannot take a single Booking.
 */
export const SEEDED_REGION_CLOSURE_REGIONS = [
  'auli',
  'spiti',
  'leh-ladakh',
  'lonavala',
  'andaman',
] as const

/** Seeded commission tiers (no FK; identified by name). */
export const SEEDED_COMMISSION_TIER_NAMES = [
  'catalog-seasonal-review',
  'diwali-festival-2026-catalog',
  'water-sports-monsoon-boost-catalog',
] as const

/** Seeded pricing tiers (no FK; identified by name). */
export const SEEDED_PRICING_TIER_NAMES = [
  'peak-season-catalog-surcharge',
  'off-peak-catalog-discount',
] as const

/**
 * Tables the purge must never touch, with the reason each is here.
 * `audit_logs` is not merely undesirable to delete — migration 0005
 * installs a BEFORE DELETE trigger that unconditionally RAISEs, so
 * including it would abort the whole single-transaction purge AFTER the
 * operator approved the counts.
 */
export const NEVER_PURGE_TABLES = [
  'blog_posts',
  'audit_logs',
  'newsletter_subscribers',
  'schema_migrations',
  'slug_redirects',
  // No seed module writes ai_generations, so every row is a real
  // AI-surface audit record (ADR-0010). Its requested_by_user_id is
  // SET NULL, so purging a seeded User correctly nulls the column and
  // leaves the audit row intact.
  'ai_generations',
  // Written only by the app's own site-builder; the seeded rows are
  // cosmetic and purging them would blank the admin CMS.
  'site_content',
] as const

/**
 * THE deletion predicate. Fails safe: anything not positively identified
 * as seed — null, empty, a phone-only User with no email, a phone-signup
 * temp address — is treated as real and left alone.
 */
export function isSeedEmail(email: unknown): boolean {
  if (typeof email !== 'string' || email.length === 0) return false
  return email.toLowerCase().endsWith(SEED_EMAIL_DOMAIN)
}

/** Corroboration helper — never the sole basis for a delete. */
export function isSeedUserId(userId: unknown): boolean {
  if (typeof userId !== 'string' || userId.length === 0) return false
  return SEED_USER_ID_PREFIXES.some((prefix) => userId.startsWith(prefix))
}

/**
 * Seeded media rows hotlink Unsplash and own no bucket object, so they
 * are safe to delete. A real upload (`experiences/…`, `reviews/…`,
 * `blog/…`) owns a world-readable GCS object that a DB transaction
 * cannot delete atomically — so it is never classified as seed.
 */
export function isSeedMediaStorageKey(storageKey: unknown): boolean {
  if (typeof storageKey !== 'string' || storageKey.length === 0) return false
  return storageKey.startsWith(SEED_MEDIA_KEY_PREFIX)
}
