import type { Metadata } from 'next'
import Image from 'next/image'
import Link from 'next/link'
import type { ReactElement } from 'react'
import { getTranslations, setRequestLocale } from 'next-intl/server'
import {
  ChevronDown,
  CreditCard,
  MapPin,
  Search,
  ShieldCheck,
  XCircle,
} from 'lucide-react'

import { ExperienceCard } from '@/components/experience-card'
import { Badge } from '@/components/ui/badge'
import { db } from '@/db/client'
import { env } from '@/lib/env'
import { getActivityIcon } from '@/lib/home/activity-icons'
import { loadHomePageData } from '@/lib/home/queries'
import { getHeroImage, getRegionImage } from '@/lib/images'
import { generateAlternates } from '@/lib/seo/hreflang'

export const revalidate = 60

/**
 * Max activity chips shown on phones before collapsing the rest behind a
 * "+N more" link. Sized for ~2 rows at 375px; md+ shows every chip.
 */
const MOBILE_CHIP_CAP = 6

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

  // Trust band — opaque chips on an opaque strip (Direction B). Each pairs a
  // semantic-status colour with a lucide icon (status never by colour alone,
  // DESIGN.md §1.3) so it clears AA over imagery where the as-is overlaid
  // micro-text failed.
  const trustChips = [
    {
      key: 'freeCancellation',
      Icon: XCircle,
      label: t('trustBadges.freeCancellation'),
      variant: 'success' as const,
    },
    {
      key: 'kycVerified',
      Icon: ShieldCheck,
      label: t('trustBadges.kycVerified'),
      variant: 'success' as const,
    },
    {
      key: 'transparentPricing',
      Icon: CreditCard,
      label: t('trustBadges.transparentPricing'),
      variant: 'info' as const,
    },
  ]

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

      {/* CINEMATIC HERO (Direction B) — full-bleed photo + scrim, opaque search
          card lifted off the image, opaque trust strip, activity chip scroll. */}
      <section className="relative flex min-h-[88vh] flex-col items-center justify-center overflow-hidden pt-20 pb-12">
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
          {/* Scrim: darker at top (keeps the overlay header's white text AA)
              and bottom, so the display headline + chips read over imagery. The
              mid-stop is deepened (was /45) because the headline + subtitle sit
              vertically centred over the busiest, lightest part of the hero
              photo — the prior mid value left the subtitle low-contrast. */}
          <div className="absolute inset-0 bg-gradient-to-b from-black/75 via-black/60 to-black/80" />
        </div>

        <div className="relative z-10 mx-auto flex w-full max-w-3xl flex-col items-center px-4 text-center">
          <h1 className="max-w-3xl whitespace-pre-line text-h1 font-heading font-bold text-white sm:text-display">
            {t('hero.title')}
          </h1>

          <p className="mt-5 max-w-lg text-base text-white [text-shadow:0_1px_3px_rgb(0_0_0/0.6)] sm:text-lg">
            {t('hero.subtitle')}
          </p>

          {/* Opaque search card — bg-surface-0, --shadow-lg lifts it off the
              photo. The field + button are full-contrast (fixes the as-is
              translucent low-contrast overlay). */}
          <form
            action="/search"
            method="get"
            className="mt-8 flex w-full max-w-xl flex-col gap-2 rounded-[var(--radius-card)] bg-surface-0 p-2 shadow-[var(--shadow-lg)] ring-1 ring-foreground/10 sm:flex-row sm:items-center"
          >
            <label htmlFor="home-search" className="sr-only">
              {t('hero.searchLabel')}
            </label>
            <div className="flex flex-1 items-center gap-2 rounded-[var(--radius-control)] bg-surface-1 px-4 focus-within:ring-2 focus-within:ring-ring">
              <Search
                className="size-4 shrink-0 text-muted-foreground"
                aria-hidden="true"
              />
              <input
                id="home-search"
                name="q"
                type="search"
                placeholder={t('hero.searchPlaceholder')}
                className="h-11 flex-1 bg-transparent text-sm text-foreground placeholder:text-muted-foreground focus:outline-none"
              />
            </div>
            <button
              type="submit"
              className="min-tap inline-flex h-11 items-center justify-center gap-2 rounded-[var(--radius-control)] bg-primary px-6 text-sm font-semibold text-primary-foreground transition-colors duration-150 hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              <Search className="size-4" aria-hidden="true" />
              {t('hero.searchButton')}
            </button>
          </form>

          {/* Opaque trust strip — semantic-status chips with paired icons. */}
          <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
            {trustChips.map(({ key, Icon, label, variant }) => (
              <Badge
                key={key}
                variant={variant}
                className="h-7 px-3 py-1 text-xs shadow-[var(--shadow-sm)]"
              >
                <Icon aria-hidden="true" />
                {label}
              </Badge>
            ))}
          </div>

          {/* Activity-category chips — pill Badges with lucide icons. Wrap at all
              widths (no h-scroll). Phones cap at MOBILE_CHIP_CAP with a "+N more"
              link to /search; tablet/desktop (md+) show every chip. */}
          {data.featuredActivities.length > 0 && (
            <nav
              aria-label={t('activities.heading')}
              className="mt-8 w-full max-w-xl"
            >
              <ul className="flex flex-wrap justify-center gap-2">
                {data.featuredActivities.map((a, index) => {
                  const Icon = getActivityIcon(a.slug)
                  return (
                    <li
                      key={a.slug}
                      className={index >= MOBILE_CHIP_CAP ? 'hidden md:block' : ''}
                    >
                      <Link
                        href={`/search?activity=${a.slug}`}
                        className="min-tap inline-flex items-center gap-2 whitespace-nowrap rounded-[var(--radius-pill)] bg-surface-0 px-4 py-2 text-sm font-medium text-foreground shadow-[var(--shadow-sm)] ring-1 ring-foreground/10 transition-colors duration-150 hover:bg-surface-1 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
                      >
                        <Icon
                          className="size-4 text-primary-strong"
                          aria-hidden="true"
                        />
                        {a.displayNameEn}
                      </Link>
                    </li>
                  )
                })}
                {data.featuredActivities.length > MOBILE_CHIP_CAP && (
                  <li className="md:hidden">
                    <Link
                      href="/search"
                      data-testid="activities-more"
                      className="min-tap inline-flex items-center gap-2 whitespace-nowrap rounded-[var(--radius-pill)] bg-surface-0 px-4 py-2 text-sm font-medium text-foreground shadow-[var(--shadow-sm)] ring-1 ring-foreground/10 transition-colors duration-150 hover:bg-surface-1 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
                    >
                      {t('activities.more', {
                        count: data.featuredActivities.length - MOBILE_CHIP_CAP,
                      })}
                    </Link>
                  </li>
                )}
              </ul>
            </nav>
          )}
        </div>

        {/* Scroll indicator */}
        <div className="absolute bottom-6 left-1/2 z-10 -translate-x-1/2 animate-bounce motion-reduce:animate-none">
          <ChevronDown className="size-6 text-white/70" aria-hidden="true" />
        </div>
      </section>

      {/* DESTINATIONS — decision-complete tiles with activity counts */}
      <section
        aria-label={t('destinations.heading')}
        className="mx-auto max-w-6xl px-4 py-[var(--space-section)] sm:px-6"
      >
        <header className="mb-8 flex items-baseline justify-between">
          <h2 className="font-heading text-h3 font-bold tracking-tight">
            {t('destinations.heading')}
          </h2>
          <Link
            href="/search"
            className="text-sm font-medium text-primary-strong underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            {t('destinations.browseAll')}
          </Link>
        </header>
        <ul className="grid grid-cols-2 gap-[var(--space-grid-gap)] md:grid-cols-3 lg:grid-cols-4">
          {data.featuredDestinations.map((d) => (
            <li key={d.slug}>
              <Link
                href={`/search?region=${d.slug}`}
                className="group relative block overflow-hidden rounded-[var(--radius-card)] shadow-[var(--shadow-sm)] transition-all duration-200 hover:-translate-y-0.5 hover:shadow-[var(--shadow-md)] focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50 motion-reduce:hover:translate-y-0"
              >
                <div className="relative aspect-[3/2]">
                  <Image
                    src={getRegionImage(d.slug)}
                    alt=""
                    role="presentation"
                    fill
                    className="object-cover transition-transform duration-500 group-hover:scale-105 motion-reduce:group-hover:scale-100"
                    sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 25vw"
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-black/75 via-black/20 to-transparent" />
                </div>
                <div className="absolute inset-x-0 bottom-0 p-3">
                  <p className="font-heading text-sm font-semibold text-white">
                    {d.displayNameEn}
                  </p>
                  <p className="flex items-center gap-1 text-xs text-white/85">
                    <MapPin className="size-3 shrink-0" aria-hidden="true" />
                    {d.state}
                  </p>
                  {/* Dark glass pill + white text (NOT bg-white/text-foreground,
                      which is white-on-white in dark mode). White on a >=60%
                      black scrim over the photo is AA-safe in both themes. */}
                  {d.experienceCount > 0 && (
                    <p className="mt-1.5 inline-flex items-center rounded-[var(--radius-pill)] bg-black/60 px-2 py-0.5 text-xs font-medium tabular-nums text-white backdrop-blur-sm">
                      {t('destinations.experienceCount', {
                        count: d.experienceCount,
                      })}
                    </p>
                  )}
                </div>
              </Link>
            </li>
          ))}
        </ul>
      </section>

      {/* FEATURED EXPERIENCES — A1 decision-complete card grid */}
      {data.featuredExperiences.length > 0 && (
        <section
          aria-label={t('featured.heading')}
          className="mx-auto max-w-6xl px-4 pb-[var(--space-section)] sm:px-6"
        >
          <header className="mb-8 flex items-baseline justify-between">
            <h2 className="font-heading text-h3 font-bold tracking-tight">
              {t('featured.heading')}
            </h2>
            <Link
              href="/search"
              className="text-sm font-medium text-primary-strong underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              {t('featured.viewAll')}
            </Link>
          </header>
          <div className="grid grid-cols-1 gap-[var(--space-grid-gap)] md:grid-cols-2 lg:grid-cols-3">
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
                  coverImageUrl: exp.coverImageUrl,
                  difficulty: exp.difficulty,
                  ratingAvg: exp.ratingAvg,
                  ratingCount: exp.ratingCount,
                  highlight: exp.highlight,
                }}
              />
            ))}
          </div>
        </section>
      )}
    </main>
  )
}
