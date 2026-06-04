/**
 * Pure helpers for the PDP Booking-rail date + time-slot picker (#70).
 *
 * A customer first picks a DATE on the calendar, then a TIME SLOT within that
 * date. Each slot carries its remaining capacity (max attendees − already
 * booked); the participant stepper is bounded by it so a booking can never
 * exceed a slot's max attendees (the server enforces the same in booking-create).
 */

/** A bookable slot, flattened for the client island (Date → ISO strings). */
export interface CalendarSlot {
  id: string
  startAtISO: string
  endAtISO: string
  /** Seats still available = capacity − capacityTaken. */
  remaining: number
}

/** A Date as a UTC `YYYY-MM-DD` key (slots are stored/seeded in UTC). */
export function dateKey(d: Date): string {
  const y = d.getUTCFullYear()
  const m = String(d.getUTCMonth() + 1).padStart(2, '0')
  const day = String(d.getUTCDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/**
 * Group slots by calendar date (UTC), preserving each date's ascending slot
 * order. `slots` are expected sorted ascending by start time.
 */
export function slotsByDate(slots: CalendarSlot[]): Map<string, CalendarSlot[]> {
  const map = new Map<string, CalendarSlot[]>()
  for (const slot of slots) {
    const key = dateKey(new Date(slot.startAtISO))
    const bucket = map.get(key)
    if (bucket) bucket.push(slot)
    else map.set(key, [slot])
  }
  return map
}

/** True when a date has at least one slot with seats remaining. */
export function dateIsBookable(slotsForDate: CalendarSlot[] | undefined): boolean {
  return Boolean(slotsForDate?.some((s) => s.remaining > 0))
}

/** The first slot id on a date that still has seats, or null. */
export function firstBookableSlotId(slotsForDate: CalendarSlot[] | undefined): string | null {
  return slotsForDate?.find((s) => s.remaining > 0)?.id ?? null
}

/**
 * The participant-stepper ceiling for a slot: bounded by BOTH the slot's
 * remaining seats and the Experience's max group size, never below 0. So a slot
 * with 1 seat left caps the stepper at 1 (a 2-person attempt is impossible),
 * and a sold-out slot caps at 0.
 */
export function maxBookableParticipants(slotRemaining: number, maxGroupSize: number): number {
  return Math.max(0, Math.min(slotRemaining, maxGroupSize))
}

/**
 * The cells for a month grid (Sunday-start): leading `null`s to align the 1st
 * under its weekday, then one UTC `Date` per day of the month.
 */
export function monthCells(year: number, monthIndex: number): (Date | null)[] {
  const firstWeekday = new Date(Date.UTC(year, monthIndex, 1)).getUTCDay() // 0=Sun
  const daysInMonth = new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate()
  const cells: (Date | null)[] = []
  for (let i = 0; i < firstWeekday; i++) cells.push(null)
  for (let d = 1; d <= daysInMonth; d++) cells.push(new Date(Date.UTC(year, monthIndex, d)))
  return cells
}

/**
 * Localized time-range label for a slot, e.g. "7:00 – 10:00 AM". Times are
 * formatted in UTC (slots are stored/seeded in UTC) so the label matches the
 * calendar day. `endISO` is optional — when absent, only the start is shown.
 */
export function formatSlotTime(startISO: string, endISO: string | null, locale: string): string {
  const fmt = new Intl.DateTimeFormat(locale, {
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'UTC',
  })
  const start = fmt.format(new Date(startISO))
  if (!endISO) return start
  return `${start} – ${fmt.format(new Date(endISO))}`
}
