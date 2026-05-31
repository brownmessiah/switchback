import { z } from 'zod'

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
})

export type UpdateExperienceInput = z.infer<typeof updateExperienceSchema>

export interface UpdateExperienceOpts {
  /** Injected Meilisearch client for testing; defaults to the singleton. */
  searchClient?: MeiliLike
}
