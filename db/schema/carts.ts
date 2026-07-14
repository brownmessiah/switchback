import { sql } from 'drizzle-orm'
import {
  check,
  index,
  integer,
  numeric,
  pgTable,
  text,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'

import { timestamps } from './_common'
import { availabilitySlots } from './availability-slots'
import { experiencePricingVariations } from './experience-pricing-variations'
import { experiences } from './experiences'
import { users } from './users'

/**
 * Customer cart (home-redesign issue 11, ADR-0021 — amends ADR-0008).
 *
 * The cart is a SAVED LIST, never a Combo and never a money engine: at
 * checkout (issue 12) each line becomes its own independent Booking via the
 * existing `createBooking` primitive, with its own authoritative price /
 * commission / tax snapshots. `price_per_participant_snapshot` here is the
 * DISPLAY snapshot taken at add time (M2 snapshot rule: the list renders
 * stable prices), re-taken whenever the line's bracket-relevant fields
 * change — it is never charged from.
 *
 * One cart per Customer (unique customer_user_id, created lazily on first
 * add); one line per (cart, slot) — re-adding a slot merges. Slot/experience
 * deletions cascade the lines away (a saved list, nothing money-bearing to
 * preserve — bookings snapshot everything they need).
 *
 * Mirrored by hand-authored db/migrations/0035_customer_cart.sql (PGlite /
 * prod path); this drizzle definition ALSO drives the e2e DB via
 * drizzle-kit push — both must stay in lockstep.
 */

export const carts = pgTable(
  'carts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    customerUserId: text('customer_user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    ...timestamps,
  },
  (t) => [uniqueIndex('carts_one_per_customer').on(t.customerUserId)],
)

export const cartItems = pgTable(
  'cart_items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    cartId: uuid('cart_id')
      .references(() => carts.id, { onDelete: 'cascade' })
      .notNull(),
    experienceId: uuid('experience_id')
      .references(() => experiences.id, { onDelete: 'cascade' })
      .notNull(),
    slotId: uuid('slot_id')
      .references(() => availabilitySlots.id, { onDelete: 'cascade' })
      .notNull(),
    /** Optional pricing-variation selection; NULL = standard bracket pricing. */
    variationId: uuid('variation_id').references(
      () => experiencePricingVariations.id,
      { onDelete: 'set null' },
    ),
    participantCount: integer('participant_count').notNull(),
    /** DISPLAY price snapshot (rupees, 2dp) — never charged from. */
    pricePerParticipantSnapshot: numeric('price_per_participant_snapshot', {
      precision: 12,
      scale: 2,
    }).notNull(),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('cart_items_one_per_slot').on(t.cartId, t.slotId),
    index('cart_items_by_cart').on(t.cartId),
    check(
      'cart_items_participants_bounds',
      sql`${t.participantCount} >= 1 AND ${t.participantCount} <= 50`,
    ),
    check(
      'cart_items_price_non_negative',
      sql`${t.pricePerParticipantSnapshot} >= 0`,
    ),
  ],
)

export type Cart = typeof carts.$inferSelect
export type CartItem = typeof cartItems.$inferSelect
export type NewCartItem = typeof cartItems.$inferInsert
