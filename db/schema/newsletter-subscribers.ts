import { index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'

/**
 * Newsletter capture (Issue 01).
 *
 * A standalone marketing-capture table for visitors who enter their email in
 * the footer newsletter form. A subscriber is a *visitor* (may or may not be a
 * Customer) — this is NOT a User/Customer/Account/member row. It exists only to
 * persist captured marketing intent so it is usable later.
 *
 * The `email` column is stored normalized (trimmed + lowercased) and is unique,
 * so the same address — in any case/whitespace variant — de-dupes to one row.
 * De-dup is enforced at the DB via the unique index + `onConflictDoNothing`
 * (see lib/newsletter/subscribe.ts), never read-then-write in app code.
 */
export const newsletterSubscribers = pgTable(
  'newsletter_subscribers',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    email: text('email').notNull().unique(), // stored normalized (lowercased, trimmed)
    source: text('source'), // optional, e.g. 'footer'
    locale: text('locale'), // optional, e.g. 'en'
    createdAt: timestamp('created_at', { withTimezone: true })
      .default(sql`now()`)
      .notNull(),
  },
  (t) => [index('newsletter_subscribers_by_created').on(t.createdAt)],
)

export type NewsletterSubscriber = typeof newsletterSubscribers.$inferSelect
export type NewNewsletterSubscriber = typeof newsletterSubscribers.$inferInsert
