import { index, integer, pgTable, text, unique, uuid } from 'drizzle-orm/pg-core'

import { timestamps } from './_common'
import { experiences } from './experiences'

/**
 * Vendor-authored, per-Experience structured itinerary (ADR-0017). A
 * normalized child table mirroring the ADR-0009 `trip_group_itinerary_slots`
 * shape: an integer ordering column (`step_order`) and CASCADE delete on the
 * parent. This is DISTINCT from the Customer-led `trip_group_itinerary_slots`
 * — do not conflate. Steps describe the flow of a single Experience
 * (briefing → activity → debrief), optionally tagged with a `day_offset` for
 * multi-day Experiences.
 */
export const experienceItinerarySteps = pgTable(
  'experience_itinerary_steps',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    experienceId: uuid('experience_id')
      .references(() => experiences.id, { onDelete: 'cascade' })
      .notNull(),
    /** 1-based position within the Experience's itinerary. Unique per Experience. */
    stepOrder: integer('step_order').notNull(),
    title: text('title').notNull(),
    description: text('description'),
    /** 0-based day for multi-day Experiences; NULL for single-day. */
    dayOffset: integer('day_offset'),
    durationMinutes: integer('duration_minutes'),
    ...timestamps,
  },
  (t) => [
    unique('experience_itinerary_steps_order_unq').on(t.experienceId, t.stepOrder),
    index('experience_itinerary_steps_by_experience').on(t.experienceId),
  ],
)

export type ExperienceItineraryStep = typeof experienceItinerarySteps.$inferSelect
export type NewExperienceItineraryStep = typeof experienceItinerarySteps.$inferInsert
