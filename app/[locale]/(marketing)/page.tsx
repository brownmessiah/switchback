import type { Metadata } from 'next'
import Image from 'next/image'
import Link from 'next/link'
import type { ReactElement } from 'react'
import { getTranslations, setRequestLocale } from 'next-intl/server'

import { ExperienceCard } from '@/components/experience-card'
import { db } from '@/db/client'
import { env } from '@/lib/env'
import { loadHomePageData } from '@/lib/home/queries'
import { getHeroImage, getRegionImage } from '@/lib/images'
import { generateAlternates } from '@/lib/seo/hreflang'

export const revalidate = 60

const DEFAULT_DESTINATION_ACTIVITY = 'rafting'

type Props = {
  readonly params: Promise<{ locale: string }>
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params
  const t = await getTranslations({ locale, namespace: 'Metadata' })
  const alternates = generateAlternates('/', locale)
  return {
    title: t('title'),
    description: t('description'),
    alternates,
  }
}

export default async function HomePage({ params }: Props): Promise<ReactElement> {
  const { locale } = await params
  setRequestLocale(locale)

  const t = await getTranslations({ locale, namespace: 'HomePage' })
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

      {/* CINEMATIC HERO — full-viewport */}
      <section className="relative flex min-h-screen flex-col items-center justify-center overflow-hidden">
        <div className="absolute inset-0">
          <Image
            src={getHeroImage()}
            alt=""
            role="presentation"
            fill
            className="object-cover"
            priority
            sizes="100vw"
          />
          <div className="absolute inset-0 bg-gradient-to-b from-black/60 via-black/30 to-black/70" />
        </div>

        <div className="relative z-10 flex flex-col items-center px-4 text-center">
          <h1 className="max-w-3xl text-5xl font-bold leading-[1.08] tracking-tight text-white sm:text-6xl lg:text-7xl whitespace-pre-line">
            {t('hero.title')}
          </h1>

          <p className="mt-5 max-w-lg text-base text-white/80 sm:text-lg">
            {t('hero.subtitle')}
          </p>

          {/* Glassmorphic search bar */}
          <form
            action="/search"
            method="get"
            className="mt-8 flex w-full max-w-xl flex-col gap-2 rounded-2xl border border-white/25 bg-white/15 p-2 backdrop-blur-xl sm:flex-row"
          >
            <label htmlFor="home-search" className="sr-only">
              {t('hero.searchLabel')}
            </label>
            <input
              id="home-search"
              name="q"
              type="search"
              placeholder={t('hero.searchPlaceholder')}
              className="flex-1 rounded-xl bg-white/10 px-5 py-3 text-sm text-white placeholder:text-white/60 focus:bg-white/20 focus:outline-none focus:ring-2 focus:ring-white/50"
            />
            <button
              type="submit"
              className="rounded-xl bg-primary px-6 py-3 text-sm font-semibold text-primary-foreground shadow-lg transition hover:opacity-90"
            >
              {t('hero.searchButton')}
            </button>
          </form>

          {/* Trust badges on hero */}
          <div className="mt-8 flex flex-wrap items-center justify-center gap-4 sm:gap-6">
            <div className="flex items-center gap-2 text-white/80">
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
              </svg>
              <span className="text-xs font-medium sm:text-sm">{t('trustBadges.kycVerified')}</span>
            </div>
            <div className="flex items-center gap-2 text-white/80">
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <span className="text-xs font-medium sm:text-sm">{t('trustBadges.refundSla')}</span>
            </div>
            <div className="flex items-center gap-2 text-white/80">
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" />
              </svg>
              <span className="text-xs font-medium sm:text-sm">{t('trustBadges.transparentPricing')}</span>
            </div>
          </div>
        </div>

        {/* Scroll indicator */}
        <div className="absolute bottom-8 left-1/2 z-10 -translate-x-1/2 animate-bounce motion-reduce:animate-none">
          <svg
            className="h-6 w-6 text-white/60"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
            aria-hidden="true"
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        </div>
      </section>

      {/* ACTIVITIES — pill chips */}
      <section
        aria-label={t('activities.heading')}
        className="mx-auto max-w-6xl px-4 py-14 sm:px-6 sm:py-16"
      >
        <h2 className="mb-6 text-2xl font-bold tracking-tight">
          {t('activities.heading')}
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

      {/* DESTINATIONS — 4-col image grid */}
      <section
        aria-label={t('destinations.heading')}
        className="mx-auto max-w-6xl px-4 pb-16 sm:px-6 sm:pb-20"
      >
        <header className="mb-8 flex items-baseline justify-between">
          <h2 className="text-2xl font-bold tracking-tight">
            {t('destinations.heading')}
          </h2>
          <Link href="/search" className="text-sm font-medium text-foreground underline-offset-4 hover:underline">
            {t('destinations.browseAll')}
          </Link>
        </header>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          {data.featuredDestinations.map((d) => (
            <Link
              key={d.slug}
              href={`/adventure/${DEFAULT_DESTINATION_ACTIVITY}-in-${d.slug}`}
              className="group relative overflow-hidden rounded-xl"
            >
              <div className="relative aspect-[3/2]">
                <Image
                  src={getRegionImage(d.slug)}
                  alt={d.displayNameEn}
                  fill
                  className="object-cover transition-transform duration-500 group-hover:scale-105 motion-reduce:group-hover:scale-100"
                  sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 25vw"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent" />
              </div>
              <div className="absolute inset-x-0 bottom-0 p-3">
                <p className="text-sm font-semibold text-white">{d.displayNameEn}</p>
                <p className="text-xs text-white/85">{d.state}</p>
                {d.experienceCount > 0 && (
                  <p className="mt-0.5 text-xs text-white/75">
                    {t('destinations.experienceCount', { count: d.experienceCount })}
                  </p>
                )}
              </div>
            </Link>
          ))}
        </div>
      </section>

      {/* FEATURED EXPERIENCES — 4-col compact grid */}
      {data.featuredExperiences.length > 0 && (
        <section
          aria-label={t('featured.heading')}
          className="mx-auto max-w-6xl px-4 pb-20 sm:px-6 sm:pb-28"
        >
          <header className="mb-8 flex items-baseline justify-between">
            <h2 className="text-2xl font-bold tracking-tight">
              {t('featured.heading')}
            </h2>
            <Link href="/search" className="text-sm font-medium text-foreground underline-offset-4 hover:underline">
              {t('featured.viewAll')}
            </Link>
          </header>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
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
    </main>
  )
}
