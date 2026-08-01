import { index, integer, pgEnum, pgTable, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core'

import { timestamps } from './_common'
import { users } from './users'
import { vendorProfiles } from './vendor-profiles'

/**
 * The evidence set for the ADR-0007 interim verification path.
 *
 * ADR-0007's Tier-2 gate assumes Aadhaar OTP eKYC, which is not integrated.
 * The ADR's own documented fallback — PAN + government ID + selfie, reviewed
 * manually by an admin — is therefore the live path, and this is where that
 * evidence lands.
 */
export const vendorKycDocumentKindEnum = pgEnum('vendor_kyc_document_kind', [
  'government_id',
  'selfie',
  'pan_card',
  'business_proof',
])

/**
 * A KYC document belonging to one Vendor.
 *
 * NOTE the absence of a `url` column, which is the point of this table rather
 * than reusing `media_assets` (whose `url` is NOT NULL). These objects live in
 * a bucket with NO public IAM binding and are readable only through
 * short-lived signed URLs, so a durable public link must not exist — leaving
 * the column out makes storing one impossible.
 */
export const vendorKycDocuments = pgTable(
  'vendor_kyc_documents',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    vendorUserId: text('vendor_user_id')
      .notNull()
      .references(() => vendorProfiles.userId, { onDelete: 'cascade' }),
    kind: vendorKycDocumentKindEnum('kind').notNull(),
    /** Key into the PRIVATE bucket (lib/storage/private-factory.ts). */
    storageKey: text('storage_key').notNull(),
    contentType: text('content_type').notNull(),
    sizeBytes: integer('size_bytes').notNull(),
    originalFilename: text('original_filename'),
    /** The human who uploaded — RESTRICT so an audit trail is never orphaned. */
    uploadedBy: text('uploaded_by')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    ...timestamps,
  },
  (t) => [
    index('vendor_kyc_documents_by_vendor').on(t.vendorUserId),
    uniqueIndex('vendor_kyc_documents_storage_key_unique').on(t.storageKey),
  ],
)

export type VendorKycDocument = typeof vendorKycDocuments.$inferSelect
export type NewVendorKycDocument = typeof vendorKycDocuments.$inferInsert
