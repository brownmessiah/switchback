import type { ReactElement } from 'react'

import { getTranslations, setRequestLocale } from 'next-intl/server'

import { ExperienceCard, type ExperienceCardData } from '@/components/experience-card'
import { loadRecentlyViewedCardsAction } from '@/components/recently-viewed/actions'
import { RecentlyViewedRail } from '@/components/recently-viewed/rail'
import { ResultsView } from '@/components/maps/results-view'
import { ActiveFilterChips } from '@/components/search/active-filter-chips'
import { FacetForm } from '@/components/search/facet-form'
import { FiltersSheet } from '@/components/search/filters-sheet'
import { SearchBox } from '@/components/search/search-box'
import {
  SearchEmptyState,
  type SearchEmptyAlternative,
} from '@/components/search/search-empty-state'
import { ViewToggle, type SearchView } from '@/components/search/view-toggle'
import { db } from '@/db/client'
import { enrichCardBadges } from '@/lib/experiences/card-badges'
import { loadPopularSearchChips } from '@/lib/home/popular-chips'
import { toMapPins } from '@/lib/maps/pins'
import { loadExperienceCoverMap } from '@/lib/media/experience-images'
import { generateAlternates } from '@/lib/seo/hreflang'
import {
  isFilteredSearch,
  searchExperiences,
  type SearchExperiencesParams,
} from '@/lib/search/search-experiences'

export const revalidate = 60

interface PageProps {
  params: Promise<{ locale: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

function parseSearchParams(
  raw: Record<string, string | string[] | undefined>,
): SearchExperiencesParams {
  const first = (v: string | string[] | undefined): string | undefined =>
    Array.isArray(v) ? v[0] : v

  const minPrice = first(raw.minPrice)
  const maxPrice = first(raw.maxPrice)
  // ADR-0017 structured facets (issue 04). Empty strings (the "Any" option's
  // value) collapse to undefined so they don't mark the search as filtered.
  const difficulty = first(raw.difficulty)
  const durationBand = first(raw.durationBand)
  const season = first(raw.season)
  const groupSize = first(raw.groupSize)
  // Category (activity rollup) + Destination=State facets (issue 04 follow-up).
  // Empty strings (the "All …" option's value) collapse to undefined so they
  // don't mark the search as filtered.
  const category = first(raw.category)
  const state = first(raw.state)
  // Issue 10 trust-oriented filters. Empty strings collapse to undefined so an
  // unset control never marks the search as filtered (matches the existing
  // empty-string→undefined pattern). `safetyVerified` is a boolean toggle whose
  // URL value is the string "true" when active.
  const minRating = first(raw.minRating)
  const cancellation = first(raw.cancellation)
  const safetyVerified = first(raw.safetyVerified) === 'true'

  return {
    q: first(raw.q),
    activity: first(raw.activity),
    region: first(raw.region),
    minPrice: minPrice ? Number(minPrice) : undefined,
    maxPrice: maxPrice ? Number(maxPrice) : undefined,
    sort: (first(raw.sort) as SearchExperiencesParams['sort']) ?? undefined,
    difficulty: difficulty || undefined,
    durationBand: durationBand || undefined,
    seasonMonth: season ? Number(season) : undefined,
    maxGroupSize: groupSize ? Number(groupSize) : undefined,
    category: category || undefined,
    state: state || undefined,
    // `minRating` parses to a number; an empty/absent value omits it (and a
    // missing param is not filtered). `safetyVerified` is omitted when not
    // exactly "true" so `false` is never carried (an unset trust filter).
    minRating: minRating ? Number(minRating) : undefined,
    safetyVerified: safetyVerified ? true : undefined,
    cancellation: cancellation || undefined,
  }
}

export default async function SearchPage({
  params,
  searchParams,
}: PageProps): Promise<ReactElement> {
  const { locale } = await params
  setRequestLocale(locale)

  const t = await getTranslations({ locale, namespace: 'SearchPage' })

  const rawParams = await searchParams
  const parsed = parseSearchParams(rawParams)
  // `view` is display-only URL state (grid/list results layout). It is parsed
  // SEPARATELY from the search params so it never affects the result set or the
  // ADR-0013 canonical/robots rules (isFilteredSearch ignores it).
  const rawView = Array.isArray(rawParams.view) ? rawParams.view[0] : rawParams.view
  const view: SearchView = rawView === 'list' ? 'list' : 'grid'
  // `map` is display-only URL state (list/map results toggle, issue 11). Parsed
  // SEPARATELY from the search params so it never affects the result set or the
  // ADR-0013 canonical/robots rules (isFilteredSearch ignores it). The map
  // pins are derived from the SAME filtered hits — list and map are one set.
  const rawMap = Array.isArray(rawParams.map) ? rawParams.map[0] : rawParams.map
  const mapActive = rawMap === '1'
  const { hits } = await searchExperiences(parsed)
  // Pins from the SAME filtered hits (region centroids; coordinate honesty D0).
  const pins = toMapPins(hits)
  const coverMap = await loadExperienceCoverMap(db, hits.map((h) => h.id))
  // Build the card data (mapping the search facet `difficulty` onto the card)
  // then batch-enrich rating + social-proof from the DB for the rendered hits.
  const cards: ExperienceCardData[] = await enrichCardBadges(
    db,
    hits.map((hit) => ({
      id: hit.id,
      slug: hit.slug,
      title: hit.title,
      shortDescription: hit.shortDescription,
      pricePerParticipantRupees: hit.pricePerPersonRupees,
      regionSlug: hit.regionSlug,
      activitySlug: hit.activitySlug,
      coverImageUrl: coverMap.get(hit.id) ?? null,
      difficulty: (hit.difficulty ?? null) as ExperienceCardData['difficulty'],
    })),
  )

  // Zero-results state (issue 25). Only when the result set is empty do we load
  // the inventory-backed popular alternatives — high-intent Destination×Activity
  // shortcuts that are GUARANTEED to have live published inventory (D0), so the
  // empty state never offers a dead 0-result link. Localised against the SAME
  // facet namespaces the home chips + facet rail use (all 13 locales).
  const filtered = isFilteredSearch(parsed)
  const emptyAlternatives: SearchEmptyAlternative[] =
    hits.length === 0
      ? (await loadPopularSearchChips(db)).map((chip) => ({
          key: `${chip.regionSlug}:${chip.activitySlug}`,
          href: chip.href,
          label: t('results.alternativeChip', {
            destination: t(`regions.${chip.regionI18nKey}`),
            activity: t(`activities.${chip.activityI18nKey}`),
          }),
        }))
      : []

  return (
    <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:py-12">
      <header className="mb-6 flex flex-col gap-4">
        <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
          {parsed.q ? t('heading.withQuery', { query: parsed.q }) : t('heading.default')}
        </h1>
        <div className="max-w-2xl">
          <SearchBox
            initialQuery={parsed.q ?? ''}
            placeholder={t('search.placeholder')}
            label={t('search.label')}
            submitLabel={t('search.submit')}
          />
        </div>
      </header>

      {/* Mobile-only Filters trigger → opens the Sheet with the same controls.
          The desktop rail (below) is SSR and hidden on small screens. */}
      <div className="mb-6 lg:hidden">
        <FiltersSheet
          triggerLabel={t('filters.heading')}
          description={t('filters.sheetDescription')}
        >
          <FacetForm parsed={parsed} instanceId="sheet" />
        </FiltersSheet>
      </div>

      <div className="grid gap-8 lg:grid-cols-[18rem_minmax(0,1fr)]">
        {/* Persistent sticky LEFT filter rail (desktop) — Direction A. */}
        <aside
          data-testid="search-filter-rail"
          aria-label={t('filters.heading')}
          className="hidden lg:block"
        >
          <div className="sticky top-[calc(var(--header-offset)+1.5rem)]">
            <h2 className="mb-4 text-2xs font-medium uppercase tracking-[var(--tracking-eyebrow)] text-muted-foreground">
              {t('filters.heading')}
            </h2>
            <FacetForm parsed={parsed} instanceId="rail" />
          </div>
        </aside>

        {/* Dense A1-card results grid (or list, per the view toggle). */}
        <section aria-label={t('results.sectionLabel')} className="min-w-0">
          {/* Removable active-filter chips above the results (issue 10). The
              client island derives them from the parsed params and removes a
              single filter on dismiss. */}
          <ActiveFilterChips parsed={parsed} />
          <div className="mb-4 flex items-center justify-between gap-3">
            <p className="text-sm text-muted-foreground tabular-nums">
              {t('results.count', { count: hits.length })}
            </p>
            {/* Grid/list LAYOUT toggle — only meaningful for the list view, so
                it is hidden when the map is active. */}
            {!mapActive && (
              <ViewToggle
                current={view}
                gridLabel={t('view.grid')}
                listLabel={t('view.list')}
              />
            )}
          </div>
          <ResultsView
            pins={pins}
            mapActive={mapActive}
            labels={{
              list: t('map.list'),
              map: t('map.map'),
              groupLabel: t('map.toggleGroup'),
              viewExperience: t('map.viewExperience'),
              openInMaps: t('map.openInMaps'),
              fromPrice: t('map.fromPrice'),
              cityLevelNote: t('map.cityLevelNote'),
            }}
          >
            {hits.length === 0 ? (
              <SearchEmptyState
                isFiltered={filtered}
                alternatives={emptyAlternatives}
                labels={{
                  title: t('results.empty'),
                  hint: t('results.emptyHint'),
                  clearFilters: t('results.clearFilters'),
                  alternativesLabel: t('results.popularLabel'),
                }}
              />
            ) : view === 'list' ? (
              <div className="flex flex-col gap-[var(--space-grid-gap)]">
                {cards.map((card) => (
                  <ExperienceCard key={card.id} experience={card} layout="list" />
                ))}
              </div>
            ) : (
              <div className="grid gap-[var(--space-grid-gap)] md:grid-cols-2 lg:grid-cols-3">
                {cards.map((card) => (
                  <ExperienceCard key={card.id} experience={card} />
                ))}
              </div>
            )}
          </ResultsView>
        </section>
      </div>

      {/* RECENTLY VIEWED (issue 12) — guest-friendly localStorage rail, gated
          through lib/experiences/public-filter and hidden when empty. */}
      <RecentlyViewedRail fetchCards={loadRecentlyViewedCardsAction} />
    </main>
  )
}

export async function generateMetadata({ params, searchParams }: PageProps) {
  const { locale } = await params
  const t = await getTranslations({ locale, namespace: 'SearchPage' })

  // ADR-0013: bare search is indexable (index,follow, self-canonical);
  // any filter/sort variant is noindex,follow and canonicalises to the
  // unfiltered /search URL. Robots is emitted via the Metadata API so it
  // lands in <head> (in-body <meta> is not hoisted reliably).
  const parsed = parseSearchParams(await searchParams)
  const filtered = isFilteredSearch(parsed)

  return {
    title: t('metadata.title'),
    description: t('metadata.description'),
    robots: filtered
      ? { index: false, follow: true }
      : { index: true, follow: true },
    alternates: generateAlternates('/search', locale),
  }
}
