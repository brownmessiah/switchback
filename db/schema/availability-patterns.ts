import { sql } from 'drizzle-orm'
import { check, date, integer, pgTable, text, uuid } from 'drizzle-orm/pg-core'

import { timestamps } from './_common'
import { experiences } from './experiences'

/**
 * Recurring availability patterns per ADR-0011. Each row defines one
 * recurring slot template for a specific day of the week. The slot
 * materializer reads active patterns and generates concrete
 * `availability_slots` rows for the next N days.
 *
 * Schema invariants:
 *  - day_of_week in 0..6 (Sunday=0, Saturday=6)
 *  - capacity > 0
 *  - effective_from / effective_until range is optional (null = unbounded)
 *  - when both are set, effective_until >= effective_from
 */
export const availabilityPatterns = pgTable(
  'availability_patterns',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    experienceId: uuid('experience_id')
      .references(() => experiences.id, { onDelete: 'cascade' })
      .notNull(),
    dayOfWeek: integer('day_of_week').notNull(), // 0=Sunday, 6=Saturday
    startTime: text('start_time').notNull(), // "06:00"
    endTime: text('end_time').notNull(), // "09:00"
    capacity: integer('capacity').notNull(),
    effectiveFrom: date('effective_from'), // nullable = always applies
    effectiveUntil: date('effective_until'), // nullable = no end date
    ...timestamps,
  },
  (t) => [
    check('day_of_week_range', sql`${t.dayOfWeek} >= 0 AND ${t.dayOfWeek} <= 6`),
    check('pattern_positive_capacity', sql`${t.capacity} > 0`),
    check(
      'effective_range_ordered',
      sql`${t.effectiveFrom} IS NULL OR ${t.effectiveUntil} IS NULL OR ${t.effectiveUntil} >= ${t.effectiveFrom}`,
    ),
  ],
)

export type AvailabilityPattern = typeof availabilityPatterns.$inferSelect
export type NewAvailabilityPattern = typeof availabilityPatterns.$inferInsert
