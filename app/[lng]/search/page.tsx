import type { ReactElement } from 'react'

import { env } from '@/lib/env'
import {
  isFilteredSearch,
  searchExperiences,
  type SearchExperiencesParams,
} from '@/lib/search/search-experiences'

/**
 * Faceted search route per ADR-0013 (Task 23).
 *
 * Canonical: `/{lng}/search` for ALL filter/sort variants — no
 * canonical fragmentation. `noindex, follow` when any filter beyond
 * the bare canonical is active; `index, follow` only on the unfiltered
 * view so Google indexes one canonical URL.
 */

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
    <main>
      {filtered ? (
        <meta name="robots" content="noindex, follow" />
      ) : (
        <meta name="robots" content="index, follow" />
      )}

      <header>
        <h1>Search Experiences</h1>
        {parsed.q && <p>Results for &ldquo;{parsed.q}&rdquo;</p>}
      </header>

      <section aria-label="Filters">
        <form method="get" action={`${prefix}/search`}>
          <label>
            Activity
            <select name="activity" defaultValue={parsed.activity ?? ''}>
              <option value="">All</option>
              <option value="rafting">Rafting</option>
              <option value="paragliding">Paragliding</option>
              <option value="trekking">Trekking</option>
              <option value="scuba-diving">Scuba Diving</option>
              <option value="camping">Camping</option>
              <option value="bungee-jumping">Bungee Jumping</option>
              <option value="skiing">Skiing</option>
              <option value="kayaking">Kayaking</option>
              <option value="rock-climbing">Rock Climbing</option>
              <option value="zip-lining">Zip Lining</option>
            </select>
          </label>

          <label>
            Sort by
            <select name="sort" defaultValue={parsed.sort ?? 'relevance'}>
              <option value="relevance">Relevance</option>
              <option value="price_asc">Price: Low to High</option>
              <option value="price_desc">Price: High to Low</option>
              <option value="newest">Newest</option>
            </select>
          </label>

          <label>
            Min price
            <input
              type="number"
              name="minPrice"
              defaultValue={parsed.minPrice ?? ''}
              min={0}
            />
          </label>

          <label>
            Max price
            <input
              type="number"
              name="maxPrice"
              defaultValue={parsed.maxPrice ?? ''}
              min={0}
            />
          </label>

          <button type="submit">Search</button>
        </form>
      </section>

      <section aria-label="Search results">
        {hits.length === 0 ? (
          <p>No Experiences found. Try adjusting your filters.</p>
        ) : (
          <ul>
            {hits.map((hit) => (
              <li key={hit.id}>
                <a href={`${prefix}/experience/${hit.slug}`}>
                  <h2>{hit.title}</h2>
                  {hit.shortDescription && <p>{hit.shortDescription}</p>}
                  <p>From ₹{hit.pricePerPersonRupees} per person</p>
                </a>
              </li>
            ))}
          </ul>
        )}
      </section>
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
