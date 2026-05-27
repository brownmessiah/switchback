import { integer, pgTable, text, uuid } from 'drizzle-orm/pg-core'

import { timestamps } from './_common'
import { users } from './users'

/**
 * Media asset lifecycle tracking. Every uploaded file (Experience photos,
 * KYC docs, blog images, vendor avatars) gets a row here linking the
 * storage-layer key to the domain entity that owns it.
 *
 * `entityType` + `entityId` form a polymorphic FK — we query
 * "all images for experience X" via a filtered index rather than
 * separate per-entity join tables, keeping the schema lean.
 */
export const mediaAssets = pgTable('media_assets', {
  id: uuid('id').primaryKey().defaultRandom(),
  uploadedBy: text('uploaded_by')
    .references(() => users.id, { onDelete: 'restrict' })
    .notNull(),
  storageKey: text('storage_key').notNull(),
  url: text('url').notNull(),
  contentType: text('content_type').notNull(),
  sizeBytes: integer('size_bytes').notNull(),
  altText: text('alt_text'),
  entityType: text('entity_type').notNull(), // 'experience' | 'blog' | 'vendor'
  entityId: text('entity_id').notNull(),
  ...timestamps,
})

export type MediaAsset = typeof mediaAssets.$inferSelect
export type NewMediaAsset = typeof mediaAssets.$inferInsert
