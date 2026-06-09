/**
 * Issue 14 — pure current-index navigation for the PDP fullscreen gallery.
 *
 * A circular index walk over a fixed-length image list. "next" from the last
 * image wraps to the first; "previous" from the first wraps to the last. An
 * empty gallery (`total === 0`) clamps to 0 so callers never index into nothing.
 */

/** The index after `current` in a `total`-length gallery, wrapping at the end. */
export function nextIndex(current: number, total: number): number {
  if (total <= 0) return 0
  return (current + 1) % total
}

/** The index before `current` in a `total`-length gallery, wrapping at the start. */
export function prevIndex(current: number, total: number): number {
  if (total <= 0) return 0
  return (current - 1 + total) % total
}
