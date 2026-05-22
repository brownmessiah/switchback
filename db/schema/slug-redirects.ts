import { pgEnum, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core'

import { timestamps } from './_common'

/**
 * Slug-redirect entity types per ADR-0013. Retired slugs cannot be
 * reused for 365 days; enforcement is application-layer (the publish
 * Server Action queries this table during slug-uniqueness check).
 */
export const slugEntityTypeEnum = pgEnum('slug_entity_type', [
  'experience',
  'vendor',
  'combo',
])

/**
 * 301-redirect support per ADR-0013. When a slug changes, the old slug
 * is preserved in this table so old URLs continue to resolve. Lookups
 * are on the hot path of every public URL; cache aggressively (Redis
 * TTL 24h, invalidated on slug change).
 */
export const slugRedirects = pgTable(
  'slug_redirects',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    entityType: slugEntityTypeEnum('entity_type').notNull(),
    entityId: text('entity_id').notNull(),
    oldSlug: text('old_slug').notNull(),
    retiredAt: timestamp('retired_at', { withTimezone: true }).defaultNow().notNull(),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('slug_redirects_unique_per_type').on(t.entityType, t.oldSlug),
  ],
)

export type SlugRedirect = typeof slugRedirects.$inferSelect
export type NewSlugRedirect = typeof slugRedirects.$inferInsert
