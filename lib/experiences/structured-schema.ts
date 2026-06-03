import { z } from 'zod'

/**
 * Structured Experience attribute validation + display helpers (ADR-0017).
 *
 * This is the pure domain layer the PDP, search indexer, Vendor form, and dev
 * seed all reuse so the bounds live in exactly one place. Every scalar/array
 * field is optional/nullable: a bare Experience (legacy row, minimal draft)
 * must validate against {@link structuredExperienceSchema} unchanged.
 *
 * The bounds mirror the DB-level CHECKs on `experiences` (migration 0022):
 * NULL passes each CHECK there, so these Zod bounds are the stricter,
 * UI-facing guard that also caps array cardinality and per-item length.
 */

/**
 * Guide languages an Experience may be offered in. Aligned with the 13
 * platform locales (ADR-0013). A `languages` array may only contain codes
 * from this set; anything outside it (e.g. 'fr') is rejected.
 */
export const KNOWN_GUIDE_LANGUAGES = [
  'en',
  'hi',
  'ta',
  'mr',
  'bn',
  'as',
  'gu',
  'kn',
  'ml',
  'or',
  'pa',
  'te',
  'ur',
] as const

export type GuideLanguage = (typeof KNOWN_GUIDE_LANGUAGES)[number]

const MINUTES_PER_HOUR = 60
const MINUTES_PER_DAY = 1440

/** A short free-text item (highlight / inclusion / exclusion / what-to-bring). */
const shortItem = z.string().trim().min(1).max(120)

function hasUniqueValues<T>(values: readonly T[]): boolean {
  return new Set(values).size === values.length
}

export const difficultySchema = z
  .enum(['easy', 'moderate', 'challenging', 'extreme'])
  .nullable()
  .optional()

export const durationMinutesSchema = z
  .number()
  .int()
  .min(15)
  .max(43200)
  .nullable()
  .optional()

export const minAgeSchema = z.number().int().min(0).max(99).nullable().optional()

export const maxGroupSizeSchema = z.number().int().min(1).max(100).nullable().optional()

export const languagesSchema = z
  .array(z.enum(KNOWN_GUIDE_LANGUAGES))
  .refine(hasUniqueValues, { message: 'Languages must be unique.' })

export const seasonMonthsSchema = z
  .array(z.number().int().min(1).max(12))
  .refine(hasUniqueValues, { message: 'Season months must be unique.' })

export const meetingPointSchema = z.string().max(500).nullable().optional()

export const highlightsSchema = z.array(shortItem).max(6)

export const inclusionsSchema = z.array(shortItem).max(15)
export const exclusionsSchema = z.array(shortItem).max(15)
export const whatToBringSchema = z.array(shortItem).max(15)

export const itineraryStepSchema = z.object({
  title: z.string().trim().min(1).max(120),
  description: z.string().max(600).nullable().optional(),
  dayOffset: z.number().int().min(0).nullable().optional(),
  durationMinutes: z.number().int().min(1).nullable().optional(),
})

export const itinerarySchema = z.array(itineraryStepSchema).max(30)

/**
 * Composite of every structured scalar/array field. All fields optional so a
 * bare Experience validates; callers (the Vendor form action) pick the subset
 * they own.
 */
export const structuredExperienceSchema = z.object({
  durationMinutes: durationMinutesSchema,
  difficulty: difficultySchema,
  minAge: minAgeSchema,
  maxGroupSize: maxGroupSizeSchema,
  languages: languagesSchema.optional(),
  meetingPoint: meetingPointSchema,
  seasonMonths: seasonMonthsSchema.optional(),
  highlights: highlightsSchema.optional(),
  inclusions: inclusionsSchema.optional(),
  exclusions: exclusionsSchema.optional(),
  whatToBring: whatToBringSchema.optional(),
})

export type StructuredExperienceInput = z.infer<typeof structuredExperienceSchema>
export type ItineraryStepInput = z.infer<typeof itineraryStepSchema>
export type ItineraryInput = z.infer<typeof itinerarySchema>

function pluralize(count: number, unit: string): string {
  return `${count} ${unit}${count === 1 ? '' : 's'}`
}

/**
 * Human-readable duration from a minute count. Rolls up minutes → hours →
 * days (1 day = 1440 min). Renders the two largest non-zero units, e.g.
 * `formatDuration(1500)` → "1 day 1 hour". Units are pluralized correctly.
 */
export function formatDuration(minutes: number): string {
  const days = Math.floor(minutes / MINUTES_PER_DAY)
  const remainderAfterDays = minutes % MINUTES_PER_DAY
  const hours = Math.floor(remainderAfterDays / MINUTES_PER_HOUR)
  const mins = remainderAfterDays % MINUTES_PER_HOUR

  const parts: string[] = []
  if (days > 0) parts.push(pluralize(days, 'day'))
  if (hours > 0) parts.push(pluralize(hours, 'hour'))
  if (mins > 0) parts.push(pluralize(mins, 'minute'))

  if (parts.length === 0) return pluralize(0, 'minute')
  return parts.join(' ')
}

const MONTH_ABBREVS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
] as const

function isContiguousAscending(sorted: number[]): boolean {
  for (let i = 1; i < sorted.length; i += 1) {
    if (sorted[i]! - sorted[i - 1]! !== 1) return false
  }
  return true
}

/**
 * Human-readable season label from a month array (1-12). A contiguous
 * ascending run renders as "First–Last" with an EN DASH (U+2013), e.g.
 * `[6,7,8,9,10]` → "Jun–Oct". A single month renders bare ("Mar"). Anything
 * non-contiguous (including wrap-around like [12,1,2]) renders as a sorted,
 * comma-separated list ("Jan, Feb, Dec"). Empty input → "" (caller omits the
 * row). Input is deduped and sorted ascending first.
 */
export function formatSeason(months: number[]): string {
  const sorted = Array.from(new Set(months)).sort((a, b) => a - b)
  if (sorted.length === 0) return ''

  const abbrevs = sorted.map((m) => MONTH_ABBREVS[m - 1]!)

  if (sorted.length === 1) return abbrevs[0]!

  if (isContiguousAscending(sorted)) {
    return `${abbrevs[0]}–${abbrevs[abbrevs.length - 1]}`
  }

  return abbrevs.join(', ')
}
