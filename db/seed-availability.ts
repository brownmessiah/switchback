import { eq } from 'drizzle-orm'

import { materializeSlots } from '@/lib/availability/slot-materializer'

import { availabilityPatterns } from './schema'

/** The Drizzle handle (top-level db, tx, or PGlite test handle) — matches what
 * `materializeSlots` accepts, so no import cycle with the seed modules. */
type SeedDb = Parameters<typeof materializeSlots>[0]

/**
 * Default weekly availability days (0=Sun … 6=Sat): Mon, Tue, Thu, Fri, Sat.
 * Deliberately NOT all seven — leaving Wed + Sun off means the booking calendar
 * shows genuine "Unavailable" days, so it reads like a real operator's schedule
 * rather than a uniformly-green test grid (visual critique).
 */
export const DEFAULT_AVAILABILITY_DAYS = [1, 2, 4, 5, 6] as const

/**
 * Multiple time windows per available day (morning / midday / afternoon) so
 * each date offers SEVERAL time slots — parity with outvers.com, where a
 * customer picks both a date and a time. Each window materialises its own slot
 * (one `availability_slots` row per day × window), each with its own capacity.
 */
export const DEFAULT_TIME_WINDOWS = [
  { startTime: '07:00', endTime: '10:00' },
  { startTime: '11:00', endTime: '14:00' },
  { startTime: '15:00', endTime: '18:00' },
] as const

interface SeedAvailabilityOptions {
  /** Per-slot capacity / max attendees (default 10). */
  capacity?: number
  /** Days of materialisation horizon (default 90). */
  daysForward?: number
}

/**
 * Seed a realistic default availability schedule for one Experience: a weekly
 * recurring pattern on {@link DEFAULT_AVAILABILITY_DAYS}, then materialise the
 * concrete `availability_slots` for the horizon so the PDP booking calendar is
 * populated with selectable dates (not the sparse 1–2 slots the seed used to
 * create). Vendors can still author their own patterns via the availability
 * manager — this is the seeded DEFAULT.
 *
 * Idempotent: patterns are inserted only when the Experience has none yet
 * (`availability_patterns` has no natural unique key), and `materializeSlots`
 * uses INSERT … ON CONFLICT DO NOTHING, so re-running is a no-op and never
 * disturbs existing (possibly booked) slots.
 */
export async function seedDefaultAvailability(
  db: SeedDb,
  experienceId: string,
  options: SeedAvailabilityOptions = {},
): Promise<void> {
  const capacity = options.capacity ?? 10

  // Authoritative reset of THIS experience's default patterns so a config change
  // (e.g. single-window → multi-window) always re-applies on reseed. Safe in the
  // seed path (these experiences' availability is seed-owned). Slots are NOT
  // deleted — materializeSlots is additive (ON CONFLICT DO NOTHING) and never
  // touches existing/booked slots.
  await db.delete(availabilityPatterns).where(eq(availabilityPatterns.experienceId, experienceId))

  // One pattern per (day × time window) → several time slots per date.
  await db.insert(availabilityPatterns).values(
    DEFAULT_AVAILABILITY_DAYS.flatMap((dayOfWeek) =>
      DEFAULT_TIME_WINDOWS.map((w) => ({
        experienceId,
        dayOfWeek,
        startTime: w.startTime,
        endTime: w.endTime,
        capacity,
      })),
    ),
  )

  await materializeSlots(db, experienceId, options.daysForward ?? 90)
}
