/**
 * Client-safe trip-planner constants and the input Zod schema.
 *
 * This module has NO server-only imports (no DB, no Anthropic SDK), so it is
 * safe to import from a client component. The server-side core in
 * `trip-planner.ts` re-exports from here; keeping them split is what prevents
 * the `server-only` Claude client from being pulled into the browser bundle.
 */
import { z } from 'zod'

/** Travel styles offered in the form. */
export const TRAVEL_STYLES = ['adventure', 'relaxed', 'family', 'budget'] as const
export type TravelStyle = (typeof TRAVEL_STYLES)[number]

/** Validated trip-planner inputs. */
export const tripPlannerInputSchema = z.object({
  region: z.string().min(1).max(64),
  activity: z.string().min(1).max(64).optional(),
  days: z.number().int().min(1).max(7),
  budgetRupees: z.number().int().min(0).max(10_000_000),
  groupSize: z.number().int().min(1).max(40),
  travelStyle: z.enum(TRAVEL_STYLES),
})
export type TripPlannerInput = z.infer<typeof tripPlannerInputSchema>
