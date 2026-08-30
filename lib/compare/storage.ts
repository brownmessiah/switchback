/**
 * Compare-selection — client-side, guest-friendly persistence (DECISION D10).
 *
 * The "Compare" selection lives in `localStorage` (no auth, no DB write) and
 * stores Experience SLUGS ONLY — never full card data and never any PII. The
 * dedicated `/compare` page always re-fetches and re-gates the selected slugs
 * server-side through `lib/experiences/public-filter`, so a slug that has since
 * become draft / paused / archived / fixture simply drops out of the comparison
 * (see `lib/compare/dataset.ts`). This mirrors the recently-viewed core
 * (`lib/recently-viewed/storage.ts`).
 *
 * This module is the pure persistence core. It takes an injectable
 * `StorageLike` (defaulting to `window.localStorage`) so:
 *   - the cap (max 3) / dedupe / order / malformed-resilience rules are
 *     unit-testable against an in-memory stub, and
 *   - server-side rendering (no `window`) is a safe no-op — pass / resolve
 *     `undefined` and every function degrades to empty / no-op instead of
 *     throwing on `window is not defined`.
 *
 * All storage access is wrapped in try/catch: a blocked store (private mode,
 * quota, disabled cookies) must never crash a page — the feature just goes
 * quiet.
 *
 * Selection ORDER is insertion order (oldest-first) — that is the order the
 * `/compare` table renders columns left-to-right, so a stable order keeps the
 * table predictable as the visitor adds listings.
 */

/** localStorage key holding the JSON array of compare-selected slugs. */
export const COMPARE_STORAGE_KEY = 'switchback-compare'

/**
 * Maximum slugs that can be compared at once (DECISION D10). A side-by-side
 * table of more than three columns is unreadable on mobile, so a 4th add is
 * rejected (the visitor must remove one first).
 */
export const COMPARE_MAX = 3

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
 * Read the compare-selected slugs in insertion order (oldest-first). Resilient
 * to every malformed-storage case: missing key, non-JSON, non-array JSON, and
 * arrays containing non-string / empty entries all collapse to a clean result
 * without throwing. An over-long stored array (e.g. tampered storage) is capped
 * to `COMPARE_MAX` on read. SSR / unavailable storage → `[]`.
 */
export function getCompareSlugs(storage?: StorageLike | null): string[] {
  const store = resolveStorage(storage)
  if (!store) return []

  let raw: string | null
  try {
    raw = store.getItem(COMPARE_STORAGE_KEY)
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

  return parsed
    .filter(isValidSlug)
    .map((slug) => slug.trim())
    .slice(0, COMPARE_MAX)
}

/** Persist the next selection, swallowing storage failures (best-effort). */
function write(store: StorageLike, slugs: readonly string[]): void {
  try {
    store.setItem(COMPARE_STORAGE_KEY, JSON.stringify(slugs))
  } catch {
    // Storage blocked (private mode / quota) — writes are best-effort.
  }
}

/**
 * Add a slug to the compare selection. Appends to the END (insertion order),
 * de-duplicates (an already-selected slug is a no-op), and honours the
 * `COMPARE_MAX` cap (a slug that would exceed it is rejected). Empty /
 * whitespace slugs and SSR / unavailable storage are no-ops. Adding over a
 * corrupt store silently recovers by overwriting with a clean list.
 */
export function addToCompare(slug: string, storage?: StorageLike | null): void {
  if (!isValidSlug(slug)) return
  const store = resolveStorage(storage)
  if (!store) return

  const trimmed = slug.trim()
  const existing = getCompareSlugs(store)
  if (existing.includes(trimmed)) return
  if (existing.length >= COMPARE_MAX) return

  write(store, [...existing, trimmed])
}

/**
 * Remove a slug from the compare selection. A slug that is not selected is a
 * no-op. SSR / unavailable storage is a no-op.
 */
export function removeFromCompare(slug: string, storage?: StorageLike | null): void {
  if (!isValidSlug(slug)) return
  const store = resolveStorage(storage)
  if (!store) return

  const trimmed = slug.trim()
  const existing = getCompareSlugs(store)
  if (!existing.includes(trimmed)) return

  write(
    store,
    existing.filter((s) => s !== trimmed),
  )
}

/**
 * Toggle a slug's membership: add it if absent (honouring dedupe + cap), remove
 * it if present. The natural action a card "Compare" checkbox fires.
 */
export function toggleCompare(slug: string, storage?: StorageLike | null): void {
  if (!isValidSlug(slug)) return
  if (isInCompare(slug, storage)) {
    removeFromCompare(slug, storage)
  } else {
    addToCompare(slug, storage)
  }
}

/** True iff `slug` is currently in the compare selection. */
export function isInCompare(slug: string, storage?: StorageLike | null): boolean {
  if (!isValidSlug(slug)) return false
  return getCompareSlugs(storage).includes(slug.trim())
}

/** Clear the entire compare selection (the tray's "Clear" control). */
export function clearCompare(storage?: StorageLike | null): void {
  const store = resolveStorage(storage)
  if (!store) return
  try {
    store.removeItem(COMPARE_STORAGE_KEY)
  } catch {
    // Storage blocked — clearing is best-effort.
  }
}
