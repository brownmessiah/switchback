import { index, pgEnum, pgTable, text, uuid } from 'drizzle-orm/pg-core'

import { timestamps } from './_common'
import { reviews } from './reviews'
import { users } from './users'

/**
 * Moderation status for a Customer-uploaded Review photo (issue #19).
 *
 * Per DECISION D0/D5 no unmoderated user image is ever public: a photo enters
 * 'pending' on upload, an Admin moves it to 'approved' or 'rejected' through
 * the existing app/admin/reviews moderation surface, and ONLY 'approved'
 * photos render on the public Experience page.
 *
 * The .sql DDL in db/migrations/0025_review_photos.sql is the source of truth;
 * this enum must agree with it. Order is load-bearing — it matches that enum.
 */
export const reviewPhotoStatusEnum = pgEnum('review_photo_status', [
  'pending',
  'approved',
  'rejected',
])

/**
 * Dedicated photo store for Reviews. We do NOT reuse polymorphic
 * `media_assets` here because that table carries no moderation status, and
 * Review photos require an explicit pending → approved/rejected lifecycle
 * before they may render publicly.
 *
 * A photo belongs to exactly one Review (FK cascade on Review delete) and
 * records the Customer who uploaded it. Indexed on `(review_id)` for the
 * per-Review loader and on `(status)` for the moderation queue.
 */
export const reviewPhotos = pgTable(
  'review_photos',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    reviewId: uuid('review_id')
      .references(() => reviews.id, { onDelete: 'cascade' })
      .notNull(),
    uploadedByUserId: text('uploaded_by_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    storageKey: text('storage_key').notNull(),
    url: text('url').notNull(),
    status: reviewPhotoStatusEnum('status').default('pending').notNull(),
    altText: text('alt_text'),
    ...timestamps,
  },
  (table) => [
    index('review_photos_review_id_idx').on(table.reviewId),
    index('review_photos_status_idx').on(table.status),
  ],
)

export type ReviewPhoto = typeof reviewPhotos.$inferSelect
export type NewReviewPhoto = typeof reviewPhotos.$inferInsert
