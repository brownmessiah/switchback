import type { Metadata } from 'next'
import Image from 'next/image'
import Link from 'next/link'
import type { ReactElement } from 'react'
import { getTranslations, setRequestLocale } from 'next-intl/server'
import { ChevronDown, MapPin } from 'lucide-react'

import { ExperienceCard } from '@/components/experience-card'
import { loadRecentlyViewedCardsAction } from '@/components/recently-viewed/actions'
import { RecentlyViewedRail } from '@/components/recently-viewed/rail'
import { HomeHeroSearch } from '@/components/home/hero-search'
import { HomeHowItWorks } from '@/components/home/how-it-works'
import { HomeTrust } from '@/components/home/trust'
import { db } from '@/db/client'
import { env } from '@/lib/env'
import { loadHomePageData } from '@/lib/home/queries'
import { getHeroImage, getRegionImage } from '@/lib/images'
import { generateAlternates } from '@/lib/seo/hreflang'
import { organization } from '@/lib/seo/schemas/organization'
import { website } from '@/lib/seo/schemas/website'

export const revalidate = 60

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

      {/* CINEMATIC HERO — Headout-style minimal (owner screenshots
          2026-06-11): full-bleed photo + scrim, headline, ONE search bar.
          The chip rows / CTA buttons / 4-field module are gone (clutter).
          The trust strip that used to sit directly below moved to the END of
          the page (issue 02 / CR9), so destinations now land right after the
          hero. */}
      <section className="relative flex min-h-[72vh] flex-col items-center justify-center overflow-hidden pt-20 pb-12">
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
              and bottom, so the display headline reads over imagery. The
              mid-stop is deepened (was /45) because the headline + brand line
              sit vertically centred over the busiest, lightest part of the
              hero photo — the prior mid value left mid-hero text
              low-contrast. */}
          <div className="absolute inset-0 bg-gradient-to-b from-black/75 via-black/60 to-black/80" />
        </div>

        <div className="relative z-10 mx-auto flex w-full max-w-3xl flex-col items-center px-4 text-center">
          {/* Brand-forward H1 (home-redesign issue 01 / CR2) — the single
              page heading, softened per the owner brief. The SEO keywords the
              old keyword-H1 + subtitle carried are preserved (D4) in the
              sr-only <h2> below + Metadata title/description + the
              Organization JSON-LD. NOTE: a hidden heading carries less
              ranking weight than the old visible H1 — an accepted tradeoff
              of the owner's declutter directive; watch Search Console. */}
          <h1 className="max-w-3xl text-balance text-h1 font-heading font-bold text-white sm:text-display">
            {t('hero.title')}
          </h1>

          {/* Visually-hidden keyword subheading (D4): keeps a crawlable,
              screen-reader-visible keyword heading without re-cluttering the
              hero the owner asked to simplify (the visible subtitle was
              removed by CR3). */}
          <h2 className="sr-only">{t('hero.seoSubheading')}</h2>

          {/* The search bar IS the call to action (Headout pattern): one
              "Destination or activity" field GET-posting to /search?q=. The
              supply-side "List your experience" CTA lives permanently in the
              header + footer instead of duplicating here; the popular/trust/
              category chip rows are gone (judged clutter in the owner's
              screenshot pass, 2026-06-11). */}
          <HomeHeroSearch />

          {/* Secondary emotional brand line — kept from the original hero, now
              a smaller line below the search (a paragraph, not the page
              heading). */}
          <p className="mt-5 text-sm font-medium text-white/80 [text-shadow:0_1px_2px_rgb(0_0_0/0.6)] sm:text-base">
            {t('hero.brandLine')}
          </p>
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
                  fromPriceRupees: exp.fromPriceRupees,
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

      {/* COMPACT TRUST STRIP — closes the page as a final reassurance band
          (home-redesign issue 02 / CR9; previously directly under the hero,
          owner screenshots 2026-06-11). */}
      <HomeTrust />
    </main>
  )
}
