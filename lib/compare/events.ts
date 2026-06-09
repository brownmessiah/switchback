/**
 * Same-page compare-selection sync.
 *
 * The compare selection lives in `localStorage`, but the browser only fires the
 * native `storage` event in OTHER tabs — not in the tab that wrote it. So a
 * card's `CompareToggle` and the global `CompareTray` (mounted in the layout)
 * would not see each other's writes within the same page. This tiny module
 * bridges that gap with a custom `window` event that every compare component
 * subscribes to and every mutation broadcasts. It is SSR-safe (no-op when
 * `window` is absent).
 */

/** Custom DOM event name broadcast after any compare-selection mutation. */
export const COMPARE_CHANGE_EVENT = 'outvers:compare-change'

/** Broadcast that the compare selection changed (same-page listeners refresh). */
export function emitCompareChange(): void {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new Event(COMPARE_CHANGE_EVENT))
}

/**
 * Subscribe to compare-selection changes — both the same-page custom event and
 * the cross-tab native `storage` event. Returns an unsubscribe function. SSR /
 * no-window is a no-op returning a no-op cleanup.
 */
export function onCompareChange(listener: () => void): () => void {
  if (typeof window === 'undefined') return () => {}
  window.addEventListener(COMPARE_CHANGE_EVENT, listener)
  window.addEventListener('storage', listener)
  return () => {
    window.removeEventListener(COMPARE_CHANGE_EVENT, listener)
    window.removeEventListener('storage', listener)
  }
}
