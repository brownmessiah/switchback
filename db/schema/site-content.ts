import { sql } from 'drizzle-orm'
import {
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'

/**
 * CMS content store for the site builder.
 *
 * Each row is one (section, key, locale) triple.  The value column is a
 * JSONB blob whose shape depends on the section — the server action layer
 * validates section-specific schemas via Zod before persisting.
 *
 * Every save bumps `version` (optimistic-lock style counter that also
 * gives ops an undo-trail).  `updated_by_admin_id` records who last
 * touched the row for the audit log.
 *
 * Sections:
 *   hero, announcement_bar, homepage, branding, seo, footer
 */
export const SITE_SECTIONS = [
  'hero',
  'announcement_bar',
  'homepage',
  'branding',
  'seo',
  'footer',
] as const

export type SiteSection = (typeof SITE_SECTIONS)[number]

export const siteContent = pgTable(
  'site_content',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    section: text('section').notNull(),
    key: text('key').notNull(),
    value: jsonb('value').default(sql`'{}'::jsonb`).notNull(),
    locale: text('locale').default('en').notNull(),
    version: integer('version').default(1).notNull(),
    updatedByAdminId: text('updated_by_admin_id'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .default(sql`now()`)
      .notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .default(sql`now()`)
      .notNull(),
  },
  (t) => [
    uniqueIndex('site_content_section_key_locale_uq').on(
      t.section,
      t.key,
      t.locale,
    ),
    index('site_content_by_section').on(t.section),
    index('site_content_by_locale').on(t.locale),
  ],
)

export type SiteContent = typeof siteContent.$inferSelect
export type NewSiteContent = typeof siteContent.$inferInsert
