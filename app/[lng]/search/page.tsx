import type { ReactElement } from 'react'

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
import { env } from '@/lib/env'
import {
  isFilteredSearch,
  searchExperiences,
  type SearchExperiencesParams,
} from '@/lib/search/search-experiences'

export const revalidate = 60

interface PageProps {
  params: Promise<{ lng: string }>
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
  const { lng } = await params
  const rawParams = await searchParams
  const parsed = parseSearchParams(rawParams)
  const filtered = isFilteredSearch(parsed)
  const { hits } = await searchExperiences(parsed)
  const prefix = lng === 'en' ? '' : `/${lng}`

  return (
    <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6 lg:py-12">
      {filtered ? (
        <meta name="robots" content="noindex, follow" />
      ) : (
        <meta name="robots" content="index, follow" />
      )}

      <header className="mb-8">
        <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
          {parsed.q ? `Results for "${parsed.q}"` : 'Explore experiences'}
        </h1>
        <p className="mt-2 text-muted-foreground">
          {hits.length} experience{hits.length === 1 ? '' : 's'} found
        </p>
      </header>

      <div className="grid gap-8 lg:grid-cols-4">
        {/* Filter sidebar */}
        <aside className="lg:col-span-1">
          <form method="get" action={`${prefix}/search`} className="space-y-5">
            {parsed.q && <input type="hidden" name="q" value={parsed.q} />}

            <div className="space-y-2">
              <Label htmlFor="activity">Activity</Label>
              <Select name="activity" defaultValue={parsed.activity ?? ''}>
                <SelectTrigger id="activity">
                  <SelectValue placeholder="All activities" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All activities</SelectItem>
                  {ACTIVITIES.map((a) => (
                    <SelectItem key={a.value} value={a.value}>
                      {a.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="sort">Sort by</Label>
              <Select name="sort" defaultValue={parsed.sort ?? 'relevance'}>
                <SelectTrigger id="sort">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="relevance">Relevance</SelectItem>
                  <SelectItem value="price_asc">Price: Low to High</SelectItem>
                  <SelectItem value="price_desc">Price: High to Low</SelectItem>
                  <SelectItem value="newest">Newest</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="minPrice">Min ₹</Label>
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
                <Label htmlFor="maxPrice">Max ₹</Label>
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
              Apply filters
            </Button>
          </form>
        </aside>

        {/* Results grid */}
        <section aria-label="Search results" className="lg:col-span-3">
          {hits.length === 0 ? (
            <div className="flex flex-col items-center justify-center rounded-xl border border-dashed py-16 text-center">
              <p className="text-lg font-medium">No experiences found</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Try adjusting your filters or search for something else.
              </p>
            </div>
          ) : (
            <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
              {hits.map((hit) => (
                <ExperienceCard
                  key={hit.id}
                  prefix={prefix}
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

export async function generateMetadata({ params }: PageProps): Promise<{
  title: string
  description: string
  alternates: { canonical: string }
}> {
  const { lng } = await params
  const baseUrl = env.NEXT_PUBLIC_APP_URL.replace(/\/$/, '')
  const prefix = lng === 'en' ? '' : `/${lng}`
  return {
    title: 'Search Experiences · Outvers',
    description:
      'Search and filter adventure Experiences across India. Rafting, paragliding, trekking, scuba diving, and more from KYC-verified Vendors.',
    alternates: {
      canonical: `${baseUrl}${prefix}/search`,
    },
  }
}
