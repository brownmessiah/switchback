'use client'

import { useEffect } from 'react'

import { recordRecentlyViewed } from '@/lib/recently-viewed/storage'

interface RecentlyViewedRecorderProps {
  /** Canonical slug of the Experience being viewed (the PDP slug). */
  slug: string
}

/**
 * Invisible PDP-only client component: records the current Experience slug into
 * the visitor's recently-viewed list (localStorage) on mount. Guest-friendly —
 * no auth, no DB write, slug only (no PII). The storage core dedupes + caps +
 * orders, and is a no-op on the server / when storage is blocked.
 *
 * Mounted near the top of the Experience detail page so a view is recorded as
 * soon as the page hydrates.
 */
export function RecentlyViewedRecorder({ slug }: RecentlyViewedRecorderProps): null {
  useEffect(() => {
    recordRecentlyViewed(slug)
  }, [slug])

  return null
}
