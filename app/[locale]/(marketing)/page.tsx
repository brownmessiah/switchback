import type { Metadata } from 'next'
import Image from 'next/image'
import Link from 'next/link'
import type { ReactElement } from 'react'
import { getTranslations, setRequestLocale } from 'next-intl/server'
import {
  ChevronDown,
  CreditCard,
  MapPin,
  ShieldCheck,
  XCircle,
} from 'lucide-react'

import { ExperienceCard } from '@/components/experience-card'
import { loadRecentlyViewedCardsAction } from '@/components/recently-viewed/actions'
import { RecentlyViewedRail } from '@/components/recently-viewed/rail'
import { HomeHowItWorks } from '@/components/home/how-it-works'
import {
  HomeStructuredSearch,
  type StructuredSearchOption,
} from '@/components/home/structured-search'
import { HomeTrust } from '@/components/home/trust'
import { Badge } from '@/components/ui/badge'
import { db } from '@/db/client'
import { env } from '@/lib/env'
import { getActivityIcon } from '@/lib/home/activity-icons'
import { loadPopularSearchChips } from '@/lib/home/popular-chips'
import { loadHomePageData } from '@/lib/home/queries'
import { getHeroImage, getRegionImage } from '@/lib/images'
import { generateAlternates } from '@/lib/seo/hreflang'
import { organization } from '@/lib/seo/schemas/organization'
import { website } from '@/lib/seo/schemas/website'

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
  // `SearchPage` carries the localised region/activity display names (the same
  // ones the /search facet rail uses) so the structured-search selects + the
  // popular chips read in the active locale.
  const tFacet = await getTranslations({ locale, namespace: 'SearchPage' })
  const tHomeSearch = await getTranslations({ locale, namespace: 'HomeSearch' })
  const [data, popularChips] = await Promise.all([
    loadHomePageData(db),
    loadPopularSearchChips(db),
  ])
  const baseUrl = env.NEXT_PUBLIC_APP_URL.replace(/\/$/, '')

  // Structured-search options — only inventory-backed (count > 0) regions /
  // activities (DECISION D0). `displayNameHi` etc. live in the registry, but we
  // resolve the LABEL via the SearchPage.regions/activities namespace so the
  // selects localise across all 13 locales (the registry only ships en + hi).
  function slugToFacetKey(slug: string): string {
    return slug.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase())
  }
  const destinationOptions: StructuredSearchOption[] = data.featuredDestinations
    .filter((d) => d.experienceCount > 0)
    .map((d) => ({
      slug: d.slug,
      i18nKey: slugToFacetKey(d.slug),
      nameEn: tFacet(`regions.${slugToFacetKey(d.slug)}`),
    }))
  const activityOptions: StructuredSearchOption[] = data.featuredActivities
    .filter((a) => a.experienceCount > 0)
    .map((a) => ({
      slug: a.slug,
      i18nKey: slugToFacetKey(a.slug),
      nameEn: tFacet(`activities.${slugToFacetKey(a.slug)}`),
    }))

  // Home JSON-LD (ADR-0013): exactly ONE WebSite node (with the sitelinks
  // SearchAction) + one Organization node. The SearchAction target deep-links
  // into the existing /search?q= query. `logo` points at the real served
  // favicon asset; `contactPoint` uses the real support address. `sameAs` is
  // intentionally OMITTED — the footer's social links are still placeholders,
  // so we never invent profile URLs (D0).
  const websiteJson = website({
    url: baseUrl,
    searchUrlTemplate: `${baseUrl}/search?q={search_term_string}`,
  })

  const organizationJson = organization({
    url: baseUrl,
    logo: `${baseUrl}/favicon.ico`,
    contactEmail: 'support@outvers.com',
    description:
      'Indian adventure-activity marketplace — rafting, paragliding, scuba, trekking from KYC-verified vendors.',
  })

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
          {/* Keyword-forward H1 (issue 02 / DECISION D1) — the single page
              heading, optimised for marketplace credibility + SEO. */}
          <h1 className="max-w-3xl text-balance text-h1 font-heading font-bold text-white sm:text-display">
            {t('hero.title')}
          </h1>

          <p className="mt-5 max-w-lg text-base text-white [text-shadow:0_1px_3px_rgb(0_0_0/0.6)] sm:text-lg">
            {t('hero.subtitle')}
          </p>

          {/* Explicit marketplace CTAs. Primary -> /search (Customers).
              Secondary -> Vendor onboarding (supply side). Both carry .min-tap
              for >=44px mobile tap targets (ADR-0018) and visible focus rings
              for keyboard users. */}
          <div className="mt-7 flex w-full max-w-md flex-col items-center justify-center gap-3 sm:flex-row">
            <Link
              href="/search"
              className="min-tap inline-flex h-12 w-full items-center justify-center gap-2 rounded-[var(--radius-control)] bg-primary px-6 text-sm font-semibold text-primary-foreground shadow-[var(--shadow-md)] transition-colors duration-150 hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50 sm:w-auto"
            >
              {t('hero.exploreCta')}
            </Link>
            {/* Supply-side CTA → public /vendor-partner landing (issue 06),
                which funnels into the auth-gated /vendor/onboarding. */}
            <Link
              href="/vendor-partner"
              className="min-tap inline-flex h-12 w-full items-center justify-center gap-2 rounded-[var(--radius-control)] bg-surface-0/95 px-6 text-sm font-semibold text-foreground shadow-[var(--shadow-md)] ring-1 ring-foreground/10 transition-colors duration-150 hover:bg-surface-0 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50 sm:w-auto"
            >
              {t('hero.listCta')}
            </Link>
          </div>

          {/* Secondary emotional brand line — kept from the original hero, now
              a smaller line below the keyword heading (a paragraph, not the
              page heading). */}
          <p className="mt-4 text-sm font-medium text-white/80 [text-shadow:0_1px_2px_rgb(0_0_0/0.6)] sm:text-base">
            {t('hero.brandLine')}
          </p>

          {/* Structured 4-field search (issue 09) — Destination / Activity /
              Date / Group size, mapped onto the EXISTING /search facets via
              lib/search/home-query (no new query infra). Replaces the single
              keyword field while keeping the H1 + CTAs above intact. Options are
              inventory-backed (DECISION D0). Desktop = inline bar; phone = a
              full-screen overlay (ADR-0018 large touch targets). */}
          <HomeStructuredSearch
            destinations={destinationOptions}
            activities={activityOptions}
          />

          {/* Popular search chips (issue 09 / D0) — high-intent Destination ×
              Activity shortcuts; only pairs with REAL published inventory
              render, each deep-linking into a pre-filtered /search. */}
          {popularChips.length > 0 && (
            <nav
              aria-label={tHomeSearch('popular.heading')}
              className="mt-5 w-full max-w-xl"
            >
              <p className="mb-2 text-xs font-medium uppercase tracking-[var(--tracking-eyebrow)] text-white/80 [text-shadow:0_1px_2px_rgb(0_0_0/0.6)]">
                {tHomeSearch('popular.heading')}
              </p>
              <ul className="flex flex-wrap justify-center gap-2">
                {popularChips.map((chip) => (
                  <li key={`${chip.regionSlug}:${chip.activitySlug}`}>
                    <Link
                      href={chip.href}
                      data-testid="home-popular-chip"
                      className="min-tap inline-flex items-center gap-2 whitespace-nowrap rounded-[var(--radius-pill)] bg-surface-0/95 px-4 py-2 text-sm font-medium text-foreground shadow-[var(--shadow-sm)] ring-1 ring-foreground/10 transition-colors duration-150 hover:bg-surface-0 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
                    >
                      {tHomeSearch('popular.chip', {
                        destination: tFacet(`regions.${chip.regionI18nKey}`),
                        activity: tFacet(`activities.${chip.activityI18nKey}`),
                      })}
                    </Link>
                  </li>
                ))}
              </ul>
            </nav>
          )}

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

      {/* ADVENTURE YOU CAN TRUST — six descriptive trust cards (issue 08).
          No fabricated metrics; each card maps to real product behaviour. */}
      <HomeTrust />

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

      {/* RECENTLY VIEWED (issue 12) — guest-friendly localStorage rail. Reads
          the visitor's recently-viewed slugs client-side, re-fetches + re-gates
          them through lib/experiences/public-filter (no fixture/unpublished
          leak), and renders newest-first. Hidden entirely when empty. */}
      <RecentlyViewedRail fetchCards={loadRecentlyViewedCardsAction} />

      {/* HOW OUTVERS WORKS — five sequential steps (issue 08). Crawlable HTML,
          stacks on mobile, no horizontal scroll. */}
      <HomeHowItWorks />
    </main>
  )
}
