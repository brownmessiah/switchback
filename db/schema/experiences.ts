import { sql } from 'drizzle-orm'
import {
  boolean,
  check,
  integer,
  numeric,
  pgEnum,
  pgTable,
  smallint,
  text,
  uuid,
} from 'drizzle-orm/pg-core'

import { timestamps } from './_common'
import { vendorProfiles } from './vendor-profiles'

/**
 * Cancellation policy presets per ADR-0005. `custom` requires admin
 * approval at Experience-creation time; the plain-language text lives
 * in `cancellation_policy_text` only for the `custom` case (presets
 * source their text from a constant in lib/payments/refund-policy.ts).
 */
export const cancellationPresetEnum = pgEnum('cancellation_preset', [
  'flexible',
  'moderate',
  'strict',
  // ADR-0005 revision 2026-06-16 (issue #09): fourth named preset whose refund
  // function ALWAYS returns 0. A Customer cancellation routes to Dispute. Still
  // a named, constant-driven preset — no per-Experience free-form refund fields.
  'non_cancellable',
  'custom',
])

/**
 * Experience lifecycle per ADR-0007 / ADR-0013. Draft is the initial
 * state on create; pending_review queues for admin approval (Tier-2
 * vendors' first Experience publish requires approval); published is
 * the discoverable state.
 */
export const experienceStatusEnum = pgEnum('experience_status', [
  'draft',
  'pending_review',
  'published',
  'paused',
  'archived',
])

/**
 * Payment modes per ADR-0001 + ADR-0002. The `reserve_now_pay_later`
 * value is stored but rejected by the booking flow in v1 (named in
 * schema so future enablement is an allow-list flip, not a column
 * migration). Test coverage: ADR-0002.
 */
export const paymentModeEnum = pgEnum('payment_mode', [
  'full_upfront',
  'partial_pay',
  'reserve_now_pay_later',
])

/**
 * Operational difficulty rating per ADR-0017. Nullable on the Experience
 * (additive — legacy rows pre-date the field). Intended as a Meilisearch
 * facet (issue 04). Distinct from the safety stack (ADR-0015).
 */
export const experienceDifficultyEnum = pgEnum('experience_difficulty', [
  'easy',
  'moderate',
  'challenging',
  'extreme',
])

/**
 * Experience schema combining ADR-0001, ADR-0002, ADR-0005, ADR-0008,
 * ADR-0011, ADR-0013, ADR-0015. Each block of fields is annotated with
 * the ADR that governs it.
 *
 * Schema-level CHECKs:
 *   - combo_has_constituents — non-combo OR ≥2 constituent IDs
 *   - combo_slug_prefix      — combo XOR slug starts with 'combo-'
 *
 * Cross-row invariants (same-Vendor for combo constituents, slug
 * format reservation against impersonation of activity-city patterns)
 * are application-layer per ADR-0008 / ADR-0013.
 */
export const experiences = pgTable(
  'experiences',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    vendorUserId: text('vendor_user_id')
      .references(() => vendorProfiles.userId, { onDelete: 'restrict' })
      .notNull(),

    slug: text('slug').notNull().unique(),
    title: text('title').notNull(),
    shortDescription: text('short_description'),
    longDescription: text('long_description'),

    // ADR-0008 — Combos
    isCombo: boolean('is_combo').default(false).notNull(),
    comboConstituents: uuid('combo_constituents').array(),

    // ADR-0008 — Per-Experience commission override (null = fall through
    // to vendor base rate); set to 30 when isCombo=true at create time.
    commissionRateOverride: numeric('commission_rate_override', { precision: 5, scale: 2 }),

    // ADR-0005 — Cancellation policy (snapshotted onto Booking at create).
    cancellationPreset: cancellationPresetEnum('cancellation_preset').notNull(),
    cancellationPolicyText: text('cancellation_policy_text'),
    // ADR-0005 revision 2026-06-16 (issue #09): per-Experience reschedule right
    // (PRD default ON). Snapshotted onto the Booking at create so a later change
    // never alters an existing Booking's rights.
    rescheduleAllowed: boolean('reschedule_allowed').notNull().default(true),

    // ADR-0001 / ADR-0002 — Payment modes the Experience accepts.
    paymentModesAllowed: paymentModeEnum('payment_modes_allowed').array().notNull(),

    // ADR-0011 — Pricing brackets (1-2 / 3-5 / 6+). Flat-priced Vendors
    // set all three identical. The bracket fires by participant_count at
    // Booking-create.
    pricePerPerson_1_2: numeric('price_per_person_1_2', { precision: 12, scale: 2 }).notNull(),
    pricePerPerson_3_5: numeric('price_per_person_3_5', { precision: 12, scale: 2 }).notNull(),
    pricePerPerson_6_plus: numeric('price_per_person_6_plus', { precision: 12, scale: 2 }).notNull(),

    // ADR-0011 / ADR-0015 — Permit gating + safety stack.
    requiredPermits: text('required_permits').array().default([]).notNull(),
    requiresSafetyStack: boolean('requires_safety_stack').default(false).notNull(),

    // ADR-0013 — Taxonomy (controlled vocabulary in lib/regions, lib/activities).
    regionSlug: text('region_slug').notNull(),
    activitySlug: text('activity_slug').notNull(),

    // ADR-0017 — Structured Experience attributes. All additive-nullable /
    // array-default-empty so the migration never breaks the seed, the PDP, or
    // any E2E selector. The scalar quick-facts (duration, difficulty, age,
    // group size, season) are intended Meilisearch facets (issue 04).
    durationMinutes: integer('duration_minutes'),
    difficulty: experienceDifficultyEnum('difficulty'),
    minAge: integer('min_age'),
    /** Operational per-departure cap — distinct from the pricing brackets (ADR-0011). */
    maxGroupSize: integer('max_group_size'),
    languages: text('languages').array().default(sql`'{}'`),
    meetingPoint: text('meeting_point'),
    /** Months (1-12) the Experience runs; complements region_closures (ADR-0011). */
    seasonMonths: smallint('season_months').array().default(sql`'{}'`),
    highlights: text('highlights').array().default(sql`'{}'`),
    inclusions: text('inclusions').array().default(sql`'{}'`),
    exclusions: text('exclusions').array().default(sql`'{}'`),
    whatToBring: text('what_to_bring').array().default(sql`'{}'`),

    status: experienceStatusEnum('status').default('draft').notNull(),

    ...timestamps,
  },
  (t) => [
    check(
      'combo_has_constituents',
      sql`(${t.isCombo} = false) OR (COALESCE(array_length(${t.comboConstituents}, 1), 0) >= 2)`,
    ),
    check(
      'combo_slug_prefix',
      sql`(${t.isCombo} = true AND ${t.slug} LIKE 'combo-%') OR (${t.isCombo} = false AND ${t.slug} NOT LIKE 'combo-%')`,
    ),
    // ADR-0017 — structured-attribute invariants. NULL passes each CHECK
    // (the columns are additive-nullable), so legacy rows are unaffected.
    check('experiences_duration_minutes_positive', sql`${t.durationMinutes} > 0`),
    check('experiences_min_age_non_negative', sql`${t.minAge} >= 0`),
    check('experiences_max_group_size_positive', sql`${t.maxGroupSize} > 0`),
    check(
      'experiences_season_months_in_range',
      sql`${t.seasonMonths} <@ ARRAY[1,2,3,4,5,6,7,8,9,10,11,12]::smallint[]`,
    ),
  ],
)

export type Experience = typeof experiences.$inferSelect
export type NewExperience = typeof experiences.$inferInsert
