'use client'

import { useCallback, useEffect, useState } from 'react'

import { onCompareChange } from '@/lib/compare/events'
import { getCompareSlugs } from '@/lib/compare/storage'

/**
 * Client hook: the current compare-selected slugs, kept live.
 *
 * localStorage only exists client-side, so the selection is empty during SSR /
 * first paint and is read in an effect on mount. It then re-reads on every
 * compare-change broadcast (same-page custom event) and cross-tab `storage`
 * event, so a card toggle and the global tray stay in sync without prop drilling
 * or shared context.
 *
 * `hydrated` distinguishes "definitely empty" (after the mount read) from
 * "not read yet" (SSR / first paint) so consumers can avoid flashing UI.
 */
export function useCompareSelection(): { slugs: string[]; hydrated: boolean } {
  const [slugs, setSlugs] = useState<string[]>([])
  const [hydrated, setHydrated] = useState(false)

  const refresh = useCallback(() => {
    setSlugs(getCompareSlugs())
    setHydrated(true)
  }, [])

  useEffect(() => {
    refresh()
    return onCompareChange(refresh)
  }, [refresh])

  return { slugs, hydrated }
}
