'use client'

import Link from 'next/link'
import { useTranslations } from 'next-intl'
import { Scale, X } from 'lucide-react'

import { useCompareSelection } from '@/components/compare/use-compare-selection'
import { Button } from '@/components/ui/button'
import { emitCompareChange } from '@/lib/compare/events'
import { clearCompare } from '@/lib/compare/storage'

/**
 * Sticky compare tray (DECISION D10).
 *
 * Mounted globally in the locale layout so it persists across every card
 * surface (home / search / destinations / activities / category). It reads the
 * compare selection from localStorage (live, via `useCompareSelection`) and:
 *   - shows the selection count ("Compare (2)"),
 *   - links to the dedicated `/compare` page,
 *   - offers a "Clear" control to empty the selection.
 *
 * It renders NOTHING when the selection is empty — so it is invisible on a
 * fresh visit and during SSR (hidden-when-empty), and reappears the instant a
 * card's `CompareToggle` adds the first listing (same-page event sync). Tap
 * targets are min-h-tap for mobile (ADR-0018).
 */
export function CompareTray() {
  const t = useTranslations('Compare')
  const { slugs, hydrated } = useCompareSelection()

  // Hidden when empty (and during SSR / before the mount read).
  if (!hydrated || slugs.length === 0) return null

  function handleClear() {
    clearCompare()
    emitCompareChange()
  }

  return (
    <div
      data-testid="compare-tray"
      data-count={slugs.length}
      role="region"
      aria-label={t('tray.label')}
      className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-card/95 px-4 py-3 shadow-[var(--shadow-md)] backdrop-blur supports-[backdrop-filter]:bg-card/80 sm:inset-x-auto sm:right-6 sm:bottom-6 sm:rounded-[var(--radius-card)] sm:border"
    >
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 sm:mx-0">
        <span className="flex min-w-0 items-center gap-2 text-sm font-medium">
          <Scale className="size-4 shrink-0 text-primary-strong" aria-hidden="true" />
          <span className="truncate">{t('tray.count', { count: slugs.length })}</span>
        </span>
        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            data-testid="compare-tray-clear"
            onClick={handleClear}
            className="min-tap inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <X className="size-3.5" aria-hidden="true" />
            {t('tray.clear')}
          </button>
          <Button
            render={<Link href="/compare" data-testid="compare-tray-cta" />}
            size="sm"
            className="min-tap"
          >
            {t('tray.cta')}
          </Button>
        </div>
      </div>
    </div>
  )
}
