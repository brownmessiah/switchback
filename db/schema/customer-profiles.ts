import { jsonb, pgEnum, pgTable, text } from 'drizzle-orm/pg-core'

import { timestamps } from './_common'
import { users } from './users'

/**
 * Aadhaar eKYC returns a gender flag — `F`, `M`, or other. This column
 * mirrors that field for the women-only TripGroup eligibility check
 * (ADR-0009). `unverified` is the pre-KYC default; the value only
 * transitions when Aadhaar eKYC returns a value.
 */
export const aadhaarGenderVerifiedEnum = pgEnum('aadhaar_gender_verified', [
  'female',
  'male',
  'other',
  'unverified',
])

/**
 * Customer-role data per ADR-0006. FK to users.id; cascade so deleting a
 * User wipes their Customer surface (Wallet rows are wiped by their own
 * cascade in wallet_balances).
 */
export const customerProfiles = pgTable('customer_profiles', {
  userId: text('user_id')
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  wishlist: jsonb('wishlist').default([]).notNull(),
  defaultAddress: jsonb('default_address'),
  preferredLanguage: text('preferred_language').default('en').notNull(),
  // ADR-0009 — gating field for women-only TripGroup eligibility.
  aadhaarGenderVerified: aadhaarGenderVerifiedEnum('aadhaar_gender_verified')
    .default('unverified')
    .notNull(),
  // ADR-0015 — Trusted contact for safety-stack Experiences.
  trustedContactName: text('trusted_contact_name'),
  trustedContactPhone: text('trusted_contact_phone'),
  trustedContactRelationship: text('trusted_contact_relationship'),
  ...timestamps,
})

export type CustomerProfile = typeof customerProfiles.$inferSelect
export type NewCustomerProfile = typeof customerProfiles.$inferInsert
