import { sql } from 'drizzle-orm'
import { timestamp } from 'drizzle-orm/pg-core'

/**
 * Standard timestamps every domain row carries.
 * `createdAt` is `DEFAULT now()`; `updatedAt` defaults to now() and is
 * expected to be set by application-layer update statements (Drizzle does
 * not auto-update on row UPDATE).
 */
export const timestamps = {
  createdAt: timestamp('created_at', { withTimezone: true })
    .default(sql`now()`)
    .notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .default(sql`now()`)
    .notNull(),
}
