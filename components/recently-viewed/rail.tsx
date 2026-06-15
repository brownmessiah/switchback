'use client'

import { useEffect, useState, type ReactElement } from 'react'

import { useTranslations } from 'next-intl'

import { ExperienceCard, type ExperienceCardData } from '@/components/experience-card'
import { getRecentSlugs } from '@/lib/recently-viewed/storage'

interface RecentlyViewedRailProps {
  /**
   * Fetches the publicly-visible card data for the given slugs, gated through
   * `lib/experiences/public-filter` and ordered most-recent-first. In the app
   * this is the `loadRecentlyViewedCardsAction` server action; tests inject a
   * stub. Keeping the data source injected makes the rail a pure, SSR-safe
   * client component (it never touches the DB directly).
   */
  fetchCards: (slugs: string[]) => Promise<ExperienceCardData[]>
  /**
   * Whether the rail supplies its own centered width gutter
   * (`mx-auto max-w-6xl px-4 sm:px-6`). Defaults to `true` for the home and
   * /search pages, where the rail is a standalone top-level section. Pass
   * `false` on the PDP, where the rail is nested inside a `<main>` that already
   * constrains width + padding — without this the rail would double-pad and sit
   * one gutter to the right of the sibling "Similar experiences" grid.
   */
  contained?: boolean
}

/**
 * "Recently viewed" rail — surfaced on home, /search and PDP.
 *
 * localStorage only exists client-side, so the rail is a client component: it
 * reads the stored slugs in an effect (empty during SSR / first paint),
 * resolves them to gated cards via the injected `fetchCards`, and renders the
 * tiles newest-first. The rail renders NOTHING until it has at least one
 * visible card — so it is invisible when storage is empty, when every stored
 * slug is stale / unpublished / a fixture, and during SSR (hidden-when-empty).
 *
 * The cards themselves are re-fetched + re-gated server-side every render, so a
 * slug that has since become draft / paused / archived / fixture disappears
 * even though it still sits in the visitor's localStorage (guardrail D0).
 */
export function RecentlyViewedRail({
  fetchCards,
  contained = true,
}: RecentlyViewedRailProps): ReactElement | null {
  const t = useTranslations('RecentlyViewed')
  const [cards, setCards] = useState<ExperienceCardData[]>([])

  useEffect(() => {
    let active = true
    const slugs = getRecentSlugs()
    if (slugs.length === 0) {
      setCards([])
      return
    }
    fetchCards(slugs)
      .then((resolved) => {
        if (active) setCards(resolved)
      })
      .catch(() => {
        // The rail is enhancement-only — a failed fetch just keeps it hidden.
        if (active) setCards([])
      })
    return () => {
      active = false
    }
  }, [fetchCards])

  if (cards.length === 0) return null

  return (
    <section
      aria-label={t('heading')}
      data-testid="recently-viewed-rail"
      className={
        contained
          ? 'mx-auto max-w-6xl px-4 py-[var(--space-section)] sm:px-6'
          : 'py-[var(--space-section)]'
      }
    >
      <header className="mb-8">
        <h2 className="font-heading text-h3 font-bold tracking-tight">{t('heading')}</h2>
      </header>
      <div className="grid grid-cols-2 gap-[var(--space-grid-gap)] md:grid-cols-3 lg:grid-cols-4">
        {cards.map((exp) => (
          <ExperienceCard key={exp.id} experience={exp} />
        ))}
      </div>
    </section>
  )
}
