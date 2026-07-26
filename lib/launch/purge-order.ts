/**
 * FK-safe deletion order for the seed purge (launch-readiness 05).
 *
 * Hand-written rather than derived by reflecting over the Drizzle schema,
 * for two reasons:
 *
 *  1. TWO foreign keys exist only in SQL and are invisible to Drizzle —
 *     `bookings.payout_batch_id → payouts(id) ON DELETE RESTRICT`
 *     (migration 0033; db/schema/bookings.ts declares a plain uuid to
 *     dodge an import cycle) and `bookings.trip_group_id → trip_groups(id)
 *     ON DELETE SET NULL` (migration 0021). A planner ordering itself
 *     from Drizzle relations would put `payouts` before `bookings` and
 *     hit a live FK violation mid-transaction on production.
 *  2. An explicit list is auditable by a human before a destructive run.
 *
 * `purge-order.test.ts` validates this list against `information_schema`
 * on a real database, so a future migration that adds a RESTRICT edge in
 * the wrong direction fails a test rather than a production purge.
 *
 * The ordering constraints that actually bind (all RESTRICT):
 *   payments        → before bookings AND before refund_requests
 *   reviews         → before bookings        (reviews.booking_id, UNIQUE)
 *   refund_requests → before bookings
 *   bookings        → before payouts, orders, availability_slots, experiences
 *   experiences     → before vendor_profiles → before users
 *   media_assets    → before users           (uploaded_by RESTRICT)
 *   messages        → before conversations   → before users
 */

export const PURGE_TABLE_ORDER = [
  // Money leaves first: payments RESTRICT-reference bookings, orders and
  // refund_requests, so nothing above them can go until they are gone.
  'payments',
  'refund_requests',

  // Review chain — reviews RESTRICT-reference bookings.
  'review_photos',
  'reviews',

  // Conversations hang off bookings via SET NULL, messages CASCADE.
  'messages',
  'conversations',

  // Carts CASCADE from experiences and slots; delete explicitly so the
  // plan reports them rather than letting a cascade destroy them silently.
  'cart_items',
  'carts',

  // Trip groups reference bookings via SET NULL.
  'trip_group_itinerary_slots',
  'trip_group_members',
  'trip_groups',

  // Bookings RESTRICT-reference experiences, slots, orders and payouts.
  'bookings',
  'payouts',
  'orders',

  // Availability hangs off experiences (CASCADE, but explicit for counts).
  'availability_slots',
  'availability_patterns',

  // Experience children.
  'experience_itinerary_steps',
  'experience_pricing_variations',
  'experiences',

  // Polymorphic — no FK to experiences, so never cascaded. Must be
  // explicit or seeded media rows outlive their Experience.
  'media_assets',

  // Wallet + promo.
  'promo_redemptions',
  'wallet_transactions',
  'wallet_balances',
  'promo_codes',

  // Notifications + support.
  'notification_outbox',
  'notifications',
  'notification_preferences',
  'support_messages',
  'support_tickets',
  'sub_admin_invites',

  // Vendor surface — experiences must already be gone (RESTRICT).
  'vendor_fund_accounts',
  'vendor_team_members',
  'vendor_profiles',

  // Remaining profiles + auth rows, then the Users themselves.
  'customer_profiles',
  'admin_profiles',
  'sessions',
  'accounts',
  'users',

  // Content-keyed tables with no FK at all — order irrelevant, listed
  // last so the destructive user traversal is already complete.
  'region_closures',
  'commission_tiers',
  'pricing_tiers',
] as const

export type PurgeTable = (typeof PURGE_TABLE_ORDER)[number]

/** Position lookup for asserting a table precedes another. */
export function purgeOrderIndex(table: string): number {
  return (PURGE_TABLE_ORDER as readonly string[]).indexOf(table)
}
