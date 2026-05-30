import type { ReactElement } from 'react'

import { getTranslations, setRequestLocale } from 'next-intl/server'

import { ExperienceCard } from '@/components/experience-card'
import { FacetForm } from '@/components/search/facet-form'
import { FiltersSheet } from '@/components/search/filters-sheet'
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

  return {
    q: first(raw.q),
    activity: first(raw.activity),
    region: first(raw.region),
    minPrice: minPrice ? Number(minPrice) : undefined,
    maxPrice: maxPrice ? Number(maxPrice) : undefined,
    sort: (first(raw.sort) as SearchExperiencesParams['sort']) ?? undefined,
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
  const { hits } = await searchExperiences(parsed)

  return (
    <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:py-12">
      <header className="mb-6 flex flex-col gap-2">
        <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
          {parsed.q ? t('heading.withQuery', { query: parsed.q }) : t('heading.default')}
        </h1>
        <p className="text-sm text-muted-foreground tabular-nums">
          {t('results.count', { count: hits.length })}
        </p>
      </header>

      {/* Mobile-only Filters trigger → opens the Sheet with the same controls.
          The desktop rail (below) is SSR and hidden on small screens. */}
      <div className="mb-6 lg:hidden">
        <FiltersSheet
          triggerLabel={t('filters.heading')}
          description={t('filters.sheetDescription')}
        >
          <FacetForm locale={locale} parsed={parsed} instanceId="sheet" />
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
            <FacetForm locale={locale} parsed={parsed} instanceId="rail" />
          </div>
        </aside>

        {/* Dense A1-card results grid. */}
        <section aria-label={t('results.sectionLabel')} className="min-w-0">
          {hits.length === 0 ? (
            <div className="flex flex-col items-center justify-center rounded-[var(--radius-card)] border border-dashed py-16 text-center">
              <p className="text-lg font-medium">{t('results.empty')}</p>
              <p className="mt-1 text-sm text-muted-foreground">
                {t('results.emptyHint')}
              </p>
            </div>
          ) : (
            <div className="grid gap-[var(--space-grid-gap)] sm:grid-cols-2 xl:grid-cols-3">
              {hits.map((hit) => (
                <ExperienceCard
                  key={hit.id}
                  experience={{
                    id: hit.id,
                    slug: hit.slug,
                    title: hit.title,
                    shortDescription: hit.shortDescription,
                    pricePerParticipantRupees: hit.pricePerPersonRupees,
                    regionSlug: hit.regionSlug,
                    activitySlug: hit.activitySlug,
                  }}
                />
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
