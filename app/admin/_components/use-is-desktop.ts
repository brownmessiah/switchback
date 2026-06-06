'use client'

import { useEffect, useState } from 'react'

/**
 * Tracks whether the viewport is at the `lg` desktop tier (≥ 1024px), the
 * Tailwind v4 default `lg` breakpoint kept verbatim per ADR-0018 (no breakpoint
 * override). Used by the admin ledger to mount EITHER the side-by-side detail
 * column (`lg`) OR the detail-as-Sheet (`< lg`) — DESIGN.md §8.4 / §8.5 item 6.
 *
 * Why a JS media query and not a CSS `hidden lg:block` toggle: the detail pane
 * carries `data-testid="ledger-detail-pane"`, asserted by the E2E suite with a
 * strict single-match `getByTestId`. A CSS toggle leaves BOTH copies in the DOM,
 * tripping strict-mode (two matches). Mounting exactly one keeps a single
 * landmark in the tree at every width.
 *
 * SSR / first-paint default is `true` (desktop): server render and jsdom (where
 * `matchMedia` is unavailable) both produce the side-by-side column — matching
 * the pre-existing layout and unit-test expectations — then a mount effect flips
 * to the Sheet on narrow viewports. First client render equals SSR, so there is
 * no hydration mismatch.
 */
const DESKTOP_QUERY = '(min-width: 1024px)'

export function useIsDesktop(): boolean {
  const [isDesktop, setIsDesktop] = useState(true)

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return
    }

    const media = window.matchMedia(DESKTOP_QUERY)
    const update = () => setIsDesktop(media.matches)

    update()
    media.addEventListener('change', update)
    return () => media.removeEventListener('change', update)
  }, [])

  return isDesktop
}
