/**
 * Pure helpers for the PDP Booking-rail date picker (#70). The calendar lets a
 * customer pick an available date; each available date maps to a real
 * availability slot id that is carried into Checkout.
 */

/** A bookable slot, flattened for the client island (Date → ISO string). */
export interface CalendarSlot {
  id: string
  startAtISO: string
}

/** A Date as a UTC `YYYY-MM-DD` key (slots are stored/seeded in UTC). */
export function dateKey(d: Date): string {
  const y = d.getUTCFullYear()
  const m = String(d.getUTCMonth() + 1).padStart(2, '0')
  const day = String(d.getUTCDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/**
 * Map each calendar date to its FIRST (earliest) slot id. `slots` are expected
 * sorted ascending by start time, so the first slot seen for a date wins.
 */
export function slotsByDate(slots: CalendarSlot[]): Map<string, string> {
  const map = new Map<string, string>()
  for (const slot of slots) {
    const key = dateKey(new Date(slot.startAtISO))
    if (!map.has(key)) map.set(key, slot.id)
  }
  return map
}

/**
 * The cells for a month grid (Sunday-start): leading `null`s to align the 1st
 * under its weekday, then one UTC `Date` per day of the month. CSS grid handles
 * the trailing row, so no trailing padding is emitted.
 */
export function monthCells(year: number, monthIndex: number): (Date | null)[] {
  const firstWeekday = new Date(Date.UTC(year, monthIndex, 1)).getUTCDay() // 0=Sun
  const daysInMonth = new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate()
  const cells: (Date | null)[] = []
  for (let i = 0; i < firstWeekday; i++) cells.push(null)
  for (let d = 1; d <= daysInMonth; d++) cells.push(new Date(Date.UTC(year, monthIndex, d)))
  return cells
}
