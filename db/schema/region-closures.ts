import { sql } from 'drizzle-orm'
import { check, pgEnum, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core'

import { timestamps } from './_common'

/**
 * Closure source per ADR-0011. `admin` covers national-level annual
 * windows (Rishikesh rafting 1 Jul – 14 Sep monsoon); `vendor` covers
 * Vendor-specific maintenance.
 *
 * Note: this is intentionally NOT scoped to individual Experiences —
 * region_closures are calendar-scoped to the geographic region so
 * multiple Vendors operating in the same region inherit the same
 * closure without duplication.
 */
export const closureSourceEnum = pgEnum('closure_source', ['admin', 'vendor'])

export const regionClosures = pgTable(
  'region_closures',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    regionSlug: text('region_slug').notNull(),
    startAt: timestamp('start_at', { withTimezone: true }).notNull(),
    endAt: timestamp('end_at', { withTimezone: true }).notNull(),
    reason: text('reason').notNull(),
    source: closureSourceEnum('source').notNull(),
    ...timestamps,
  },
  (t) => [check('closure_time_ordered', sql`${t.endAt} > ${t.startAt}`)],
)

export type RegionClosure = typeof regionClosures.$inferSelect
export type NewRegionClosure = typeof regionClosures.$inferInsert
