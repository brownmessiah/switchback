import { sql } from 'drizzle-orm'
import { boolean, check, index, integer, numeric, pgTable, text, uuid } from 'drizzle-orm/pg-core'

import { timestamps } from './_common'
import { experiences } from './experiences'

/**
 * Named per-Experience pricing variations (ADR-0011 revision 2026-06-16,
 * issue #07). A normalized child table (CASCADE delete on the parent
 * Experience) letting a Vendor offer distinct priced options on one
 * Experience — "Sunrise batch", "Private session", "With gear rental" —
 * without modelling each as a separate Experience or abusing the group-size
 * brackets.
 *
 * MONEY PATH: when a Booking is created with a valid, ACTIVE `variationId`
 * belonging to the Experience, `price_per_person` becomes the per-participant
 * price and is SNAPSHOTTED onto bookings.price_per_participant_snapshot (basis
 * `pricing_variation:<id>`). It is the TOP arm of the ADR-0011 pricing chain
 * (above the pricing-tier override). Never recomputed.
 *
 * Variations are a PRICING concept only — they SHARE the Availability slot's
 * capacity (ADR-0011). There is no per-variation capacity; the slot generator
 * and the atomic capacity-decrement are unchanged.
 *
 * `price_per_person` is numeric(12,2) — a STRING in Drizzle, never a JS float.
 */
export const experiencePricingVariations = pgTable(
  'experience_pricing_variations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    experienceId: uuid('experience_id')
      .references(() => experiences.id, { onDelete: 'cascade' })
      .notNull(),
    name: text('name').notNull(),
    description: text('description'),
    pricePerPerson: numeric('price_per_person', { precision: 12, scale: 2 }).notNull(),
    /** Optional per-variation duration override (minutes); NULL inherits the
     * Experience's duration. Distinct from capacity, which stays on the slot. */
    durationMinutes: integer('duration_minutes'),
    isActive: boolean('is_active').default(true).notNull(),
    ...timestamps,
  },
  (t) => [
    index('experience_pricing_variations_by_experience').on(t.experienceId),
    check('experience_pricing_variations_price_non_negative', sql`${t.pricePerPerson} >= 0`),
    check('experience_pricing_variations_duration_positive', sql`${t.durationMinutes} > 0`),
  ],
)

export type ExperiencePricingVariation = typeof experiencePricingVariations.$inferSelect
export type NewExperiencePricingVariation = typeof experiencePricingVariations.$inferInsert
