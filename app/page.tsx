import type { Metadata } from 'next'
import Image from 'next/image'
import Link from 'next/link'
import type { ReactElement } from 'react'

import { ExperienceCard } from '@/components/experience-card'
import { db } from '@/db/client'
import { env } from '@/lib/env'
import { loadHomePageData } from '@/lib/home/queries'
import { getHeroImage, getRegionImage } from '@/lib/images'

export const revalidate = 60

const DEFAULT_DESTINATION_ACTIVITY = 'rafting'

export async function generateMetadata(): Promise<Metadata> {
  const baseUrl = env.NEXT_PUBLIC_APP_URL.replace(/\/$/, '')
  return {
    title: 'Outvers — adventure activities in India',
    description:
      'Book rafting, paragliding, scuba, trekking and more across India. Vendor-verified Experiences with transparent refund policy and a 24-hour refund SLA.',
    alternates: { canonical: baseUrl },
  }
}

export default async function HomePage(): Promise<ReactElement> {
  const data = await loadHomePageData(db)
  const baseUrl = env.NEXT_PUBLIC_APP_URL.replace(/\/$/, '')

  const websiteJson = {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    name: 'Outvers',
    url: baseUrl,
    potentialAction: {
      '@type': 'SearchAction',
      target: `${baseUrl}/search?q={search_term_string}`,
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

      {/* HERO — full-width adventure image */}
      <section className="relative overflow-hidden">
        <div className="absolute inset-0">
          <Image
            src={getHeroImage()}
            alt="Adventure in India"
            fill
            className="object-cover"
            priority
            sizes="100vw"
          />
          <div className="absolute inset-0 bg-gradient-to-b from-black/60 via-black/40 to-black/70" />
        </div>

        <div className="relative mx-auto max-w-6xl px-4 py-24 sm:px-6 sm:py-32 lg:py-40">
          <div className="flex flex-col items-start gap-5">
            <div className="flex items-center gap-2">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-white/20 px-3 py-1 text-xs font-medium text-white backdrop-blur-sm">
                <svg className="h-3 w-3" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                </svg>
                KYC-verified vendors
              </span>
              <span className="inline-flex items-center gap-1.5 rounded-full bg-white/20 px-3 py-1 text-xs font-medium text-white backdrop-blur-sm">
                <svg className="h-3 w-3" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm1-12a1 1 0 10-2 0v4a1 1 0 00.293.707l2.828 2.829a1 1 0 101.415-1.415L11 9.586V6z" clipRule="evenodd" />
                </svg>
                24-hour refund SLA
              </span>
            </div>

            <h1 className="max-w-2xl text-4xl font-bold leading-[1.1] tracking-tight text-white sm:text-5xl lg:text-6xl">
              Find your next
              <br />
              adventure in India.
            </h1>

            <p className="max-w-lg text-base text-white/80 sm:text-lg">
              Rafting in Rishikesh. Paragliding in Bir Billing. Scuba in Goa.
              Book from verified operators with transparent pricing.
            </p>

            <form
              action="/search"
              method="get"
              className="mt-2 flex w-full max-w-lg flex-col gap-2 sm:flex-row"
            >
              <label htmlFor="home-search" className="sr-only">
                Search experiences
              </label>
              <input
                id="home-search"
                name="q"
                type="search"
                placeholder='Try "rafting Rishikesh" or "scuba Goa"'
                className="flex-1 rounded-xl border-0 bg-white px-5 py-3.5 text-sm text-foreground shadow-lg placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary"
              />
              <button
                type="submit"
                className="rounded-xl bg-primary px-6 py-3.5 text-sm font-semibold text-primary-foreground shadow-lg transition hover:opacity-90"
              >
                Search
              </button>
            </form>
          </div>
        </div>
      </section>

      {/* DESTINATIONS — image cards */}
      <section
        aria-label="Popular destinations"
        className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-20"
      >
        <header className="mb-8 flex items-baseline justify-between">
          <h2 className="text-2xl font-bold tracking-tight">
            Popular destinations
          </h2>
          <Link href="/search" className="text-sm font-medium text-primary hover:underline">
            Browse all →
          </Link>
        </header>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          {data.featuredDestinations.map((d) => (
            <Link
              key={d.slug}
              href={`/adventure/${DEFAULT_DESTINATION_ACTIVITY}-in-${d.slug}`}
              className="group relative overflow-hidden rounded-2xl"
            >
              <div className="relative aspect-[4/3]">
                <Image
                  src={getRegionImage(d.slug)}
                  alt={d.displayNameEn}
                  fill
                  className="object-cover transition-transform duration-500 group-hover:scale-105"
                  sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 25vw"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent" />
              </div>
              <div className="absolute inset-x-0 bottom-0 p-4">
                <p className="text-base font-semibold text-white">{d.displayNameEn}</p>
                <p className="text-xs text-white/70">{d.state}</p>
                {d.experienceCount > 0 && (
                  <p className="mt-1 text-xs text-white/60">
                    {d.experienceCount} experience{d.experienceCount === 1 ? '' : 's'}
                  </p>
                )}
              </div>
            </Link>
          ))}
        </div>
      </section>

      {/* ACTIVITIES — pill chips */}
      <section
        aria-label="Activities"
        className="mx-auto max-w-6xl px-4 pb-16 sm:px-6 sm:pb-20"
      >
        <h2 className="mb-6 text-2xl font-bold tracking-tight">
          Browse by activity
        </h2>
        <div className="flex flex-wrap gap-3">
          {data.featuredActivities.map((a) => (
            <Link
              key={a.slug}
              href={`/search?activity=${a.slug}`}
              className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-5 py-2.5 text-sm font-medium transition hover:border-primary hover:text-primary"
            >
              {a.displayNameEn}
              {a.experienceCount > 0 && (
                <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                  {a.experienceCount}
                </span>
              )}
            </Link>
          ))}
        </div>
      </section>

      {/* FEATURED EXPERIENCES */}
      {data.featuredExperiences.length > 0 && (
        <section
          aria-label="Featured experiences"
          className="mx-auto max-w-6xl px-4 pb-20 sm:px-6 sm:pb-28"
        >
          <header className="mb-8 flex items-baseline justify-between">
            <h2 className="text-2xl font-bold tracking-tight">
              Featured experiences
            </h2>
            <Link href="/search" className="text-sm font-medium text-primary hover:underline">
              View all →
            </Link>
          </header>
          <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {data.featuredExperiences.map((exp) => (
              <ExperienceCard
                key={exp.id}
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

      {/* TRUST BAR */}
      <section className="border-t bg-muted/50">
        <div className="mx-auto flex max-w-6xl flex-col items-center gap-8 px-4 py-16 sm:flex-row sm:justify-between sm:px-6">
          <div className="flex items-center gap-3 text-center sm:text-left">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10">
              <svg className="h-5 w-5 text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
              </svg>
            </div>
            <div>
              <p className="text-sm font-semibold">Verified vendors</p>
              <p className="text-xs text-muted-foreground">KYC-checked operators</p>
            </div>
          </div>
          <div className="flex items-center gap-3 text-center sm:text-left">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10">
              <svg className="h-5 w-5 text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <div>
              <p className="text-sm font-semibold">24-hour refund SLA</p>
              <p className="text-xs text-muted-foreground">Credited to your wallet</p>
            </div>
          </div>
          <div className="flex items-center gap-3 text-center sm:text-left">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10">
              <svg className="h-5 w-5 text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" />
              </svg>
            </div>
            <div>
              <p className="text-sm font-semibold">Transparent pricing</p>
              <p className="text-xs text-muted-foreground">No hidden fees</p>
            </div>
          </div>
        </div>
      </section>
    </main>
  )
}
