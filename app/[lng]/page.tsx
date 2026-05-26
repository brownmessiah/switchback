import type { Metadata } from 'next'
import Link from 'next/link'
import type { ReactElement } from 'react'

import { ExperienceCard } from '@/components/experience-card'
import { db } from '@/db/client'
import { env } from '@/lib/env'
import { loadHomePageData } from '@/lib/home/queries'

/**
 * Locale-aware home page per ADR-0013.
 *
 * Renders entirely on the server (no client data fetching) so crawlers
 * see the full content + JSON-LD on first byte. ISR every 60 seconds —
 * the data shape (featured destinations / activities / experiences)
 * changes on Experience publish / unpublish, both of which trigger
 * on-demand revalidation in M3.
 *
 * JSON-LD: WebSite (with SearchAction) + Organization, per ADR-0013's
 * page → schema mapping table.
 *
 * The default activity slug used in destination links is "rafting" — the
 * highest-volume Indian adventure category and the only activity guaranteed
 * to be present in every region's listicle set at launch. Destinations
 * without rafting still get a valid URL (the activity-city page renders
 * empty-state safely).
 */

export const revalidate = 60

interface PageProps {
  params: Promise<{ lng: string }>
}

const SUPPORTED_LOCALES = new Set(['en', 'hi'])
const DEFAULT_DESTINATION_ACTIVITY = 'rafting'

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { lng } = await params
  const baseUrl = env.NEXT_PUBLIC_APP_URL.replace(/\/$/, '')
  return {
    title: 'Outvers — adventure activities in India',
    description:
      'Book rafting, paragliding, scuba, trekking and more across India. Vendor-verified Experiences with transparent refund policy and a 24-hour refund SLA.',
    alternates: {
      canonical: `${baseUrl}/${lng === 'en' ? '' : lng}`,
    },
  }
}

export default async function HomePage({ params }: PageProps): Promise<ReactElement> {
  const { lng } = await params
  const safeLng = SUPPORTED_LOCALES.has(lng) ? lng : 'en'
  const prefix = safeLng === 'en' ? '' : `/${safeLng}`

  const data = await loadHomePageData(db)
  const baseUrl = env.NEXT_PUBLIC_APP_URL.replace(/\/$/, '')

  const websiteJson = {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    name: 'Outvers',
    url: `${baseUrl}/${safeLng === 'en' ? '' : safeLng}`,
    potentialAction: {
      '@type': 'SearchAction',
      target: `${baseUrl}${prefix}/search?q={search_term_string}`,
      'query-input': 'required name=search_term_string',
    },
  }

  const organizationJson = {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    name: 'Outvers',
    url: baseUrl,
    description:
      'Indian adventure-activity marketplace — rafting, paragliding, scuba, trekking from KYC-verified vendors.',
  }

  return (
    <main>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(websiteJson) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(organizationJson) }}
      />

      {/* HERO */}
      <section className="relative mx-auto max-w-6xl px-4 pt-12 pb-16 sm:px-6 sm:pt-20 sm:pb-24">
        <div className="flex flex-col items-start gap-6">
          <span className="rounded-full border border-zinc-200 px-3 py-1 text-xs font-medium uppercase tracking-wide text-zinc-600 dark:border-zinc-700 dark:text-zinc-400">
            KYC-verified vendors · 24-hour refund SLA
          </span>
          <h1 className="max-w-3xl text-4xl font-semibold leading-tight tracking-tight text-zinc-900 sm:text-5xl dark:text-zinc-50">
            Real adventures, run by real operators across India.
          </h1>
          <p className="max-w-2xl text-lg text-zinc-600 dark:text-zinc-400">
            Rafting in Rishikesh. Paragliding in Bir-Billing. Trekking in Manali.
            Scuba in Goa. Transparent pricing, slot-level availability, and your
            refund credited to your wallet within 24 hours of an eligible
            cancellation.
          </p>
          <form
            action={`${prefix}/search`}
            method="get"
            className="mt-2 flex w-full max-w-xl flex-col gap-2 sm:flex-row sm:items-center"
          >
            <label htmlFor="home-search" className="sr-only">
              Search experiences
            </label>
            <input
              id="home-search"
              name="q"
              type="search"
              placeholder="Try “rafting Rishikesh” or “scuba Goa”"
              className="flex-1 rounded-full border border-zinc-300 bg-white px-5 py-3 text-base text-zinc-900 placeholder:text-zinc-400 focus:border-zinc-900 focus:outline-none dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-50 dark:placeholder:text-zinc-500 dark:focus:border-zinc-50"
            />
            <button
              type="submit"
              className="rounded-full bg-zinc-900 px-6 py-3 text-base font-medium text-white hover:bg-zinc-700 dark:bg-zinc-50 dark:text-black dark:hover:bg-zinc-300"
            >
              Search
            </button>
          </form>
        </div>
      </section>

      {/* DESTINATIONS */}
      <section
        aria-label="Popular destinations"
        className="mx-auto max-w-6xl px-4 pb-16 sm:px-6 sm:pb-20"
      >
        <header className="mb-6 flex items-baseline justify-between">
          <h2 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
            Popular destinations
          </h2>
          <Link
            href={`${prefix}/search`}
            className="text-sm text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-50"
          >
            Browse all →
          </Link>
        </header>
        <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
          {data.featuredDestinations.map((d) => (
            <li key={d.slug}>
              <Link
                href={`${prefix}/adventure/${DEFAULT_DESTINATION_ACTIVITY}-in-${d.slug}`}
                className="flex flex-col rounded-xl border border-zinc-200 bg-white p-4 transition hover:border-zinc-400 hover:shadow-sm dark:border-zinc-800 dark:bg-zinc-950 dark:hover:border-zinc-600"
              >
                <span className="text-base font-medium text-zinc-900 dark:text-zinc-50">
                  {safeLng === 'hi' ? d.displayNameHi : d.displayNameEn}
                </span>
                <span className="mt-1 text-xs text-zinc-500 dark:text-zinc-500">
                  {d.state}
                </span>
                {d.experienceCount > 0 && (
                  <span className="mt-3 text-xs text-zinc-600 dark:text-zinc-400">
                    {d.experienceCount} experience{d.experienceCount === 1 ? '' : 's'}
                  </span>
                )}
              </Link>
            </li>
          ))}
        </ul>
      </section>

      {/* ACTIVITIES */}
      <section
        aria-label="Activities"
        className="mx-auto max-w-6xl px-4 pb-16 sm:px-6 sm:pb-20"
      >
        <header className="mb-6 flex items-baseline justify-between">
          <h2 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
            By activity
          </h2>
        </header>
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          {data.featuredActivities.map((a) => (
            <li key={a.slug}>
              <Link
                href={`${prefix}/search?activity=${a.slug}`}
                className="flex flex-col items-start gap-1 rounded-lg border border-zinc-200 bg-white px-4 py-3 transition hover:border-zinc-400 dark:border-zinc-800 dark:bg-zinc-950 dark:hover:border-zinc-600"
              >
                <span className="text-sm font-medium text-zinc-900 dark:text-zinc-50">
                  {safeLng === 'hi' ? a.displayNameHi : a.displayNameEn}
                </span>
                {a.experienceCount > 0 && (
                  <span className="text-xs text-zinc-500 dark:text-zinc-500">
                    {a.experienceCount} listed
                  </span>
                )}
              </Link>
            </li>
          ))}
        </ul>
      </section>

      {/* FEATURED EXPERIENCES */}
      {data.featuredExperiences.length > 0 && (
        <section
          aria-label="Featured experiences"
          className="mx-auto max-w-6xl px-4 pb-20 sm:px-6 sm:pb-28"
        >
          <header className="mb-6 flex items-baseline justify-between">
            <h2 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
              Featured experiences
            </h2>
            <Link
              href={`${prefix}/search`}
              className="text-sm text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-50"
            >
              View all →
            </Link>
          </header>
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {data.featuredExperiences.map((exp) => (
              <ExperienceCard
                key={exp.id}
                prefix={prefix}
                experience={{
                  id: exp.id,
                  slug: exp.slug,
                  title: exp.title,
                  shortDescription: exp.shortDescription,
                  pricePerParticipantRupees: exp.pricePerParticipantRupees,
                  regionSlug: exp.regionSlug,
                  activitySlug: exp.activitySlug,
                }}
              />
            ))}
          </div>
        </section>
      )}
    </main>
  )
}
