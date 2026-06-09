/**
 * Pure mapping from the home hero's structured 4-field search onto the EXISTING
 * `/search` facet query params (issue 09).
 *
 * This module deliberately introduces NO new query infrastructure: it targets
 * the param names `app/[locale]/(marketing)/search/page.tsx → parseSearchParams`
 * already accepts (`region`, `activity`, `season`, `groupSize`). The home hero
 * speaks the Customer's language — Destination, Activity, Date, Group size — and
 * this is the single place that translates those into the facet contract:
 *
 *   destination → region    (a regions-registry slug, e.g. "rishikesh")
 *   activity    → activity   (an activities-registry slug, e.g. "rafting")
 *   date        → season     (the MONTH 1-12 extracted from the chosen date;
 *                             the search page maps `season` → `seasonMonth`,
 *                             i.e. "Experience must run in this month". There is
 *                             no calendar-date facet and we do NOT invent one.)
 *   groupSize   → groupSize  (an integer; maps to maxGroupSize "fits a group of N")
 *
 * Empty / unset / invalid fields are OMITTED from the querystring — an empty
 * value must never appear as a param, because the search page treats an empty
 * string as "not filtered" (and a stray empty facet would also flip the page to
 * noindex under ADR-0013).
 *
 * Keep this a pure function (no React, no DB, no router) so it is unit-tested
 * directly and reused by both the structured search form and the popular chips.
 */

export interface HomeSearchFields {
  /** Regions-registry slug (the hero's "Destination" field). */
  destination?: string
  /** Activities-registry slug (the hero's "Activity" field). */
  activity?: string
  /**
   * ISO-ish date string (`YYYY-MM-DD`) from the date input. Only the MONTH is
   * used — it maps to the `season` facet (month 1-12).
   */
  date?: string
  /** Group size (the hero's "Group size" field) — mapped to `groupSize`. */
  groupSize?: number
}

/** The `/search` path the home search + chips always target. */
const SEARCH_PATH = '/search'

/**
 * Extract the calendar month (1-12) from a `YYYY-MM-DD` date string. Returns
 * `null` for empty / unparseable input so the caller omits the `season` param
 * rather than emitting `season=` (which the search page would treat as a real,
 * empty — and therefore noindex-triggering — facet).
 */
function monthFromDate(date: string | undefined): number | null {
  if (!date) return null
  // Parse as a local date — `YYYY-MM-DD` is unambiguous and we only need the
  // month. `Date.parse` of an invalid string yields NaN.
  const parsed = new Date(`${date}T00:00:00`)
  const ms = parsed.getTime()
  if (Number.isNaN(ms)) return null
  return parsed.getMonth() + 1
}

/**
 * Build the `/search` URL (path + querystring) for the given home-search
 * fields. Params are emitted in a STABLE order — region, activity, season,
 * groupSize — so the URL is deterministic for caching and snapshot tests.
 */
export function buildHomeSearchQuery(fields: HomeSearchFields): string {
  const params = new URLSearchParams()

  const destination = fields.destination?.trim()
  if (destination) params.set('region', destination)

  const activity = fields.activity?.trim()
  if (activity) params.set('activity', activity)

  const month = monthFromDate(fields.date)
  if (month !== null) params.set('season', String(month))

  if (fields.groupSize !== undefined) {
    const size = Math.floor(fields.groupSize)
    if (Number.isFinite(size) && size > 0) params.set('groupSize', String(size))
  }

  const qs = params.toString()
  return qs ? `${SEARCH_PATH}?${qs}` : SEARCH_PATH
}
