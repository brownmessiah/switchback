import type { ReactElement } from 'react'

import { getTranslations, setRequestLocale } from 'next-intl/server'

import { ExperienceCard, type ExperienceCardData } from '@/components/experience-card'
import { FacetForm } from '@/components/search/facet-form'
import { FiltersSheet } from '@/components/search/filters-sheet'
import { SearchBox } from '@/components/search/search-box'
import { ViewToggle, type SearchView } from '@/components/search/view-toggle'
import { db } from '@/db/client'
import { enrichCardBadges } from '@/lib/experiences/card-badges'
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
  const { hits } = await searchExperiences(parsed)
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
          <div className="mb-4 flex items-center justify-between gap-3">
            <p className="text-sm text-muted-foreground tabular-nums">
              {t('results.count', { count: hits.length })}
            </p>
            <ViewToggle
              current={view}
              gridLabel={t('view.grid')}
              listLabel={t('view.list')}
            />
          </div>
          {hits.length === 0 ? (
            <div className="flex flex-col items-center justify-center rounded-[var(--radius-card)] border border-dashed py-16 text-center">
              <p className="text-lg font-medium">{t('results.empty')}</p>
              <p className="mt-1 text-sm text-muted-foreground">
                {t('results.emptyHint')}
              </p>
            </div>
          ) : view === 'list' ? (
            <div className="flex flex-col gap-[var(--space-grid-gap)]">
              {cards.map((card) => (
                <ExperienceCard key={card.id} experience={card} layout="list" />
              ))}
            </div>
          ) : (
            <div className="grid gap-[var(--space-grid-gap)] sm:grid-cols-2 xl:grid-cols-3">
              {cards.map((card) => (
                <ExperienceCard key={card.id} experience={card} />
              ))}
            </div>
          )}
        </section>
      </div>
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
