import { z } from 'zod'

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
export const updateExperienceSchema = z.object({
  id: z.string().uuid(),
  title: z.string().min(1, 'Title is required').max(200),
  shortDescription: z.string().max(500).nullable().optional(),
  longDescription: z.string().max(5000).nullable().optional(),
  activitySlug: z.string().min(1, 'Activity is required'),
  regionSlug: z.string().min(1, 'Region is required'),
  pricePerPerson_1_2: z.number().positive('Price must be positive'),
  pricePerPerson_3_5: z.number().positive('Price must be positive'),
  pricePerPerson_6_plus: z.number().positive('Price must be positive'),
  cancellationPreset: z.enum(['flexible', 'moderate', 'strict', 'custom']),
  paymentModesAllowed: z
    .array(z.enum(['full_upfront', 'partial_pay', 'reserve_now_pay_later']))
    .min(1, 'At least one payment mode is required'),
  isCombo: z.boolean(),
  requiredPermits: z.array(z.string()),
  requiresSafetyStack: z.boolean(),

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

export type UpdateExperienceInput = z.infer<typeof updateExperienceSchema>

export interface UpdateExperienceOpts {
  /** Injected Meilisearch client for testing; defaults to the singleton. */
  searchClient?: MeiliLike
}
