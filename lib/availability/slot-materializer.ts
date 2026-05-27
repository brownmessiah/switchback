import { and, eq, gte, lte, or, sql } from 'drizzle-orm'

import { availabilityPatterns } from '@/db/schema/availability-patterns'
import { availabilitySlots } from '@/db/schema/availability-slots'
import { experiences } from '@/db/schema/experiences'
import { regionClosures } from '@/db/schema/region-closures'
import type { DBOrTx } from '@/lib/payments/commission-resolver'

export interface MaterializeResult {
  created: number
  skipped: number
}

/**
 * Parse an "HH:mm" time string into hours and minutes.
 */
function parseTime(time: string): { hours: number; minutes: number } {
  const [h, m] = time.split(':').map(Number)
  return { hours: h, minutes: m }
}

/**
 * Format a date as "YYYY-MM-DD" in UTC.
 */
function formatDateUTC(d: Date): string {
  const y = d.getUTCFullYear()
  const m = String(d.getUTCMonth() + 1).padStart(2, '0')
  const day = String(d.getUTCDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/**
 * Check if a date falls within a region closure range.
 * Closures use timestamps with timezone, so we compare the date
 * against the closure's start_at and end_at.
 */
function isDateInClosure(
  date: Date,
  closures: Array<{ startAt: Date; endAt: Date }>,
): boolean {
  // Compare using the start-of-day (the slot's start_at will be on this date)
  for (const closure of closures) {
    // A day is closed if any part of the day overlaps with the closure.
    // Simplification: if the date >= closure start date and < closure end date
    const dayStart = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()))
    const dayEnd = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + 1))

    if (dayStart < closure.endAt && dayEnd > closure.startAt) {
      return true
    }
  }
  return false
}

/**
 * Check if a date falls within the effective range of a pattern.
 * effectiveFrom/effectiveUntil are date strings ("YYYY-MM-DD") or null.
 */
function isDateInEffectiveRange(
  dateStr: string,
  effectiveFrom: string | null,
  effectiveUntil: string | null,
): boolean {
  if (effectiveFrom && dateStr < effectiveFrom) return false
  if (effectiveUntil && dateStr > effectiveUntil) return false
  return true
}

/**
 * Materialise concrete availability_slots rows from the recurring
 * patterns defined for an Experience. Uses INSERT ... ON CONFLICT
 * DO NOTHING to be idempotent — existing slots (including those with
 * bookings) are never touched.
 *
 * @param db - Drizzle db or transaction handle
 * @param experienceId - The experience to materialise slots for
 * @param daysForward - Number of days into the future to generate (default 90)
 * @returns Count of created and skipped slots
 */
export async function materializeSlots(
  db: DBOrTx,
  experienceId: string,
  daysForward: number = 90,
): Promise<MaterializeResult> {
  // 1. Fetch the experience to get its regionSlug
  const [experience] = await db
    .select({ id: experiences.id, regionSlug: experiences.regionSlug })
    .from(experiences)
    .where(eq(experiences.id, experienceId))
    .limit(1)

  if (!experience) {
    return { created: 0, skipped: 0 }
  }

  // 2. Fetch all patterns for this experience
  const patterns = await db
    .select()
    .from(availabilityPatterns)
    .where(eq(availabilityPatterns.experienceId, experienceId))

  if (patterns.length === 0) {
    return { created: 0, skipped: 0 }
  }

  // 3. Fetch region closures that overlap with our materialisation window
  const now = new Date()
  const windowEnd = new Date(now)
  windowEnd.setUTCDate(windowEnd.getUTCDate() + daysForward)

  const closures = await db
    .select({ startAt: regionClosures.startAt, endAt: regionClosures.endAt })
    .from(regionClosures)
    .where(
      and(
        eq(regionClosures.regionSlug, experience.regionSlug),
        // Closure overlaps if it starts before window end and ends after now
        lte(regionClosures.startAt, windowEnd),
        gte(regionClosures.endAt, now),
      ),
    )

  // 4. For each day in the window, check if any pattern matches
  const slotsToInsert: Array<{
    experienceId: string
    startAt: Date
    endAt: Date
    capacity: number
  }> = []

  for (let dayOffset = 0; dayOffset < daysForward; dayOffset++) {
    const date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + dayOffset))
    const dayOfWeek = date.getUTCDay() // 0=Sunday, 6=Saturday
    const dateStr = formatDateUTC(date)

    // Skip dates that fall in a region closure
    if (isDateInClosure(date, closures)) continue

    // Find all patterns that match this day of week
    for (const pattern of patterns) {
      if (pattern.dayOfWeek !== dayOfWeek) continue

      // Check effective date range
      if (!isDateInEffectiveRange(dateStr, pattern.effectiveFrom, pattern.effectiveUntil)) {
        continue
      }

      // Build the concrete slot timestamps
      const start = parseTime(pattern.startTime)
      const end = parseTime(pattern.endTime)

      const startAt = new Date(Date.UTC(
        date.getUTCFullYear(),
        date.getUTCMonth(),
        date.getUTCDate(),
        start.hours,
        start.minutes,
      ))

      const endAt = new Date(Date.UTC(
        date.getUTCFullYear(),
        date.getUTCMonth(),
        date.getUTCDate(),
        end.hours,
        end.minutes,
      ))

      slotsToInsert.push({
        experienceId,
        startAt,
        endAt,
        capacity: pattern.capacity,
      })
    }
  }

  if (slotsToInsert.length === 0) {
    return { created: 0, skipped: 0 }
  }

  // 5. Bulk insert with ON CONFLICT DO NOTHING
  // We batch in chunks to avoid exceeding query parameter limits
  const BATCH_SIZE = 500
  let totalCreated = 0

  for (let i = 0; i < slotsToInsert.length; i += BATCH_SIZE) {
    const batch = slotsToInsert.slice(i, i + BATCH_SIZE)

    const result = await db
      .insert(availabilitySlots)
      .values(batch)
      .onConflictDoNothing({
        target: [availabilitySlots.experienceId, availabilitySlots.startAt],
      })
      .returning({ id: availabilitySlots.id })

    totalCreated += result.length
  }

  const totalAttempted = slotsToInsert.length
  return {
    created: totalCreated,
    skipped: totalAttempted - totalCreated,
  }
}
