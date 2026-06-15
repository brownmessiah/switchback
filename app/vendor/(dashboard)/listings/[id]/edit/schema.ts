import { z } from 'zod'

import { pricingVariationsSchema } from '@/lib/experiences/pricing-variations-write'
import {
  difficultySchema,
  durationMinutesSchema,
  exclusionsSchema,
  highlightsSchema,
  inclusionsSchema,
  itinerarySchema,
  languagesSchema,
  maxGroupSizeSchema,
  meetingPointSchema,
  minAgeSchema,
  seasonMonthsSchema,
  whatToBringSchema,
} from '@/lib/experiences/structured-schema'
import type { MeiliLike } from '@/lib/search/meilisearch-client'
import {
  hasAtLeastOnePrice,
  NO_PRICE_MESSAGE,
} from '@/lib/vendor/listing-price-validation'

/**
 * Validation schema + types for the Experience edit action.
 *
 * This lives OUTSIDE the `'use server'` actions module on purpose: a
 * `'use server'` file may only export async functions (Next.js enforces
 * this at module-evaluation time, and a stray value export — like a Zod
 * schema — makes EVERY action in the file 500 when invoked from the
 * browser). Keeping the schema here lets `actions.ts` export only Server
 * Actions while sharing this contract with the form and unit tests.
 */
export const updateExperienceSchema = z
  .object({
    id: z.string().uuid(),
    title: z.string().min(1, 'Title is required').max(200),
    shortDescription: z.string().max(500).nullable().optional(),
    longDescription: z.string().max(5000).nullable().optional(),
    activitySlug: z.string().min(1, 'Activity is required'),
    regionSlug: z.string().min(1, 'Region is required'),
    // Base (1-2 bracket) price is OPTIONAL when active pricing variations carry
    // the price (issue #08). When present it must be positive. 3-5 / 6+ remain
    // optional + positive (they default to the 1-2 price on save).
    pricePerPerson_1_2: z.number().positive('Price must be positive').optional(),
    pricePerPerson_3_5: z.number().positive('Price must be positive').optional(),
    pricePerPerson_6_plus: z.number().positive('Price must be positive').optional(),
    // ADR-0005 revision 2026-06-16 (issue #09) — non_cancellable joins the
    // windowed presets; custom remains admin-gated (edit already allowed it).
    cancellationPreset: z.enum(['flexible', 'moderate', 'strict', 'non_cancellable', 'custom']),
    // Per-Experience reschedule right (PRD default ON). Optional on input so
    // existing callers need not supply it; the core applies the PRD default
    // (the DB column also defaults true).
    rescheduleAllowed: z.boolean().optional(),
    paymentModesAllowed: z
      .array(z.enum(['full_upfront', 'partial_pay', 'reserve_now_pay_later']))
      .min(1, 'At least one payment mode is required'),
    isCombo: z.boolean(),
    requiredPermits: z.array(z.string()),
    requiresSafetyStack: z.boolean(),

    // Named pricing variations (ADR-0011 revision 2026-06-16, issue #08).
    // Optional — omitting the field leaves the existing rows untouched; sending
    // `[]` clears them. The core upserts these ownership-scoped.
    pricingVariations: pricingVariationsSchema.optional(),

    // ADR-0017 structured attributes (issue 05). Additive — the form now owns
    // these. Bounds are REUSED from lib/experiences/structured-schema so the
    // ceilings (≤6 highlights, ≤15 inclusions, season month 1-12, the
    // difficulty enum, etc.) live in exactly one place.
    difficulty: difficultySchema,
    durationMinutes: durationMinutesSchema,
    minAge: minAgeSchema,
    maxGroupSize: maxGroupSizeSchema,
    languages: languagesSchema.optional(),
    meetingPoint: meetingPointSchema,
    seasonMonths: seasonMonthsSchema.optional(),
    highlights: highlightsSchema.optional(),
    inclusions: inclusionsSchema.optional(),
    exclusions: exclusionsSchema.optional(),
    whatToBring: whatToBringSchema.optional(),
    itinerary: itinerarySchema.optional(),
  })
  // The KEY rule (issue #08): a base price OR ≥1 active variation must exist.
  // On edit, `pricingVariations` may be omitted (a partial edit). When omitted
  // we cannot see the persisted variations here, so we only block when the form
  // EXPLICITLY sent a variation set (it then carries the full intended price
  // picture). The core re-derives brackets the same way.
  .refine(
    (v) =>
      v.pricingVariations === undefined ||
      hasAtLeastOnePrice({
        basePrice: v.pricePerPerson_1_2 ?? 0,
        variations: v.pricingVariations,
      }),
    { message: NO_PRICE_MESSAGE, path: ['pricePerPerson_1_2'] },
  )

export type UpdateExperienceInput = z.infer<typeof updateExperienceSchema>

export interface UpdateExperienceOpts {
  /** Injected Meilisearch client for testing; defaults to the singleton. */
  searchClient?: MeiliLike
}
