import type { ReactElement } from 'react'

import { getTranslations, setRequestLocale } from 'next-intl/server'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { ExperienceCard } from '@/components/experience-card'
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

const ACTIVITIES = [
  { value: 'rafting', label: 'Rafting' },
  { value: 'paragliding', label: 'Paragliding' },
  { value: 'trekking', label: 'Trekking' },
  { value: 'scuba', label: 'Scuba diving' },
  { value: 'camping', label: 'Camping' },
  { value: 'bungee', label: 'Bungee jumping' },
  { value: 'skiing', label: 'Skiing' },
  { value: 'kayaking', label: 'Kayaking' },
  { value: 'surfing', label: 'Surfing' },
  { value: 'canyoning', label: 'Canyoning' },
]

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
    <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6 lg:py-12">
      <header className="mb-8">
        <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
          {parsed.q ? t('heading.withQuery', { query: parsed.q }) : t('heading.default')}
        </h1>
        <p className="mt-2 text-muted-foreground">
          {t('results.count', { count: hits.length })}
        </p>
      </header>

      <div className="grid gap-8 lg:grid-cols-4">
        {/* Filter sidebar */}
        <aside className="lg:col-span-1">
          <form method="get" action="/search" className="space-y-5">
            {parsed.q && <input type="hidden" name="q" value={parsed.q} />}

            <div className="space-y-2">
              <Label htmlFor="activity">{t('filters.activity')}</Label>
              <Select name="activity" defaultValue={parsed.activity ?? ''}>
                <SelectTrigger id="activity">
                  <SelectValue placeholder={t('filters.allActivities')} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t('filters.allActivities')}</SelectItem>
                  {ACTIVITIES.map((a) => (
                    <SelectItem key={a.value} value={a.value}>
                      {a.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="sort">{t('filters.sortBy')}</Label>
              <Select name="sort" defaultValue={parsed.sort ?? 'relevance'}>
                <SelectTrigger id="sort">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="relevance">{t('filters.relevance')}</SelectItem>
                  <SelectItem value="price_asc">{t('filters.priceLowHigh')}</SelectItem>
                  <SelectItem value="price_desc">{t('filters.priceHighLow')}</SelectItem>
                  <SelectItem value="newest">{t('filters.newest')}</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="minPrice">{t('filters.minPrice')}</Label>
                <Input
                  id="minPrice"
                  type="number"
                  name="minPrice"
                  defaultValue={parsed.minPrice ?? ''}
                  min={0}
                  placeholder="0"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="maxPrice">{t('filters.maxPrice')}</Label>
                <Input
                  id="maxPrice"
                  type="number"
                  name="maxPrice"
                  defaultValue={parsed.maxPrice ?? ''}
                  min={0}
                  placeholder="Any"
                />
              </div>
            </div>

            <Button type="submit" className="w-full">
              {t('filters.applyFilters')}
            </Button>
          </form>
        </aside>

        {/* Results grid */}
        <section aria-label="Search results" className="lg:col-span-3">
          {hits.length === 0 ? (
            <div className="flex flex-col items-center justify-center rounded-xl border border-dashed py-16 text-center">
              <p className="text-lg font-medium">{t('results.empty')}</p>
              <p className="mt-1 text-sm text-muted-foreground">
                {t('results.emptyHint')}
              </p>
            </div>
          ) : (
            <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
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
