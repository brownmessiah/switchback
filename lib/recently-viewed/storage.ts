/**
 * Recently-viewed Experiences — client-side, guest-friendly persistence.
 *
 * The list lives in `localStorage` (no auth, no DB write) and stores Experience
 * SLUGS ONLY — never full card data and never any PII. The displayed cards are
 * always re-fetched and re-gated server-side through
 * `lib/experiences/public-filter`, so a slug that has since become
 * draft / paused / archived / fixture simply disappears from the rail
 * (see `lib/recently-viewed/loader.ts`).
 *
 * This module is the pure persistence core. It takes an injectable
 * `StorageLike` (defaulting to `window.localStorage`) so:
 *   - the cap / dedupe / recency / malformed-resilience rules are unit-testable
 *     against an in-memory stub, and
 *   - server-side rendering (no `window`) is a safe no-op — pass / resolve
 *     `undefined` and every function degrades to empty / no-op instead of
 *     throwing on `window is not defined`.
 *
 * All storage access is wrapped in try/catch: a blocked store (private mode,
 * quota, disabled cookies) must never crash a page — the feature just goes
 * quiet.
 */

/** localStorage key holding the JSON array of recently-viewed slugs. */
export const RECENTLY_VIEWED_STORAGE_KEY = 'switchback-recently-viewed'

/**
 * Maximum slugs retained. Recording past the cap drops the oldest. Sized to
 * comfortably back a single rail (which itself renders fewer) while keeping the
 * stored JSON tiny.
 */
export const RECENTLY_VIEWED_CAP = 12

/** The subset of the DOM `Storage` interface this module relies on. */
export interface StorageLike {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

/**
 * Resolve the storage to use. An explicit argument wins (tests, callers that
 * already hold a reference); otherwise fall back to `window.localStorage` when
 * it exists. Returns `null` on the server or when storage is unavailable so
 * callers degrade gracefully.
 */
function resolveStorage(storage?: StorageLike | null): StorageLike | null {
  if (storage) return storage
  if (typeof window === 'undefined') return null
  try {
    return window.localStorage
  } catch {
    return null
  }
}

/** True for a usable, non-empty slug after trimming. */
function isValidSlug(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

/**
 * Read the recently-viewed slugs, most-recent-first. Resilient to every
 * malformed-storage case: missing key, non-JSON, non-array JSON, and arrays
 * containing non-string / empty entries all collapse to a clean result without
 * throwing. SSR / unavailable storage → `[]`.
 */
export function getRecentSlugs(storage?: StorageLike | null): string[] {
  const store = resolveStorage(storage)
  if (!store) return []

  let raw: string | null
  try {
    raw = store.getItem(RECENTLY_VIEWED_STORAGE_KEY)
  } catch {
    return []
  }
  if (!raw) return []

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return []
  }
  if (!Array.isArray(parsed)) return []

  return parsed.filter(isValidSlug).map((slug) => slug.trim())
}

/**
 * Record a viewed Experience slug: prepend to the front (most-recent-first),
 * de-duplicate (a re-view moves the slug to the front rather than adding a
 * second entry), and cap to `RECENTLY_VIEWED_CAP` (oldest dropped). Empty /
 * whitespace slugs and SSR / unavailable storage are no-ops. Recording over a
 * corrupt store silently recovers by overwriting with a clean list.
 */
export function recordRecentlyViewed(slug: string, storage?: StorageLike | null): void {
  if (!isValidSlug(slug)) return
  const store = resolveStorage(storage)
  if (!store) return

  const trimmed = slug.trim()
  const existing = getRecentSlugs(store)
  const next = [trimmed, ...existing.filter((s) => s !== trimmed)].slice(
    0,
    RECENTLY_VIEWED_CAP,
  )

  try {
    store.setItem(RECENTLY_VIEWED_STORAGE_KEY, JSON.stringify(next))
  } catch {
    // Storage blocked (private mode / quota) — recording is best-effort.
  }
}
