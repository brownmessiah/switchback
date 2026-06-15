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
import {
  hasAtLeastOnePrice,
  NO_PRICE_MESSAGE,
} from '@/lib/vendor/listing-price-validation'

/**
 * Validation schema + types for the Experience CREATE action.
 *
 * Like the edit-action schema, this lives OUTSIDE the `'use server'` module:
 * a `'use server'` file may only export async functions, so the Zod schema
 * (a value export) stays here and is shared with the action core and tests.
 *
 * Create persists the initial DRAFT. Required fields mirror the original
 * manual checks (title / activity / region / a positive headline price). The
 * 3-5 and 6+ brackets are optional at create (the form defaults them to the
 * 1-2 price). The ADR-0017 structured scalar/array facets + itinerary are all
 * optional — a Vendor may finish them in the edit step — and REUSE the bounds
 * from lib/experiences/structured-schema.
 */
export const createExperienceSchema = z
  .object({
    title: z.string().min(1, 'Title is required').max(200),
    shortDescription: z.string().max(500).nullable().optional(),
    activitySlug: z.string().min(1, 'Activity is required'),
    regionSlug: z.string().min(1, 'Region is required'),
    // The base (1-2 bracket) price is now OPTIONAL: an Experience may instead
    // carry its price entirely on active pricing variations (issue #08). The
    // .refine() below enforces "base price OR ≥1 active variation". When a base
    // price IS given it must be positive.
    pricePerPerson_1_2: z.number().positive('Price must be positive').optional(),
    pricePerPerson_3_5: z.number().positive('Price must be positive').optional(),
    pricePerPerson_6_plus: z.number().positive('Price must be positive').optional(),
    // Create offers only the three presets (custom requires admin approval and
    // surfaces in edit only), matching the new-listing stepper.
    cancellationPreset: z.enum(['flexible', 'moderate', 'strict']),

    // Named pricing variations (ADR-0011 revision 2026-06-16, issue #08) —
    // optional; defaults to none. The active ones can stand in for a base price.
    pricingVariations: pricingVariationsSchema.optional(),

    // ADR-0017 structured attributes (issue 05) — all optional on create.
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
  // The KEY rule (issue #08): a listing must have a positive base price OR at
  // least one ACTIVE pricing variation. Enforced via the shared pure validator.
  .refine(
    (v) =>
      hasAtLeastOnePrice({
        basePrice: v.pricePerPerson_1_2 ?? 0,
        variations: v.pricingVariations ?? [],
      }),
    { message: NO_PRICE_MESSAGE, path: ['pricePerPerson_1_2'] },
  )

export type CreateExperienceInput = z.infer<typeof createExperienceSchema>
