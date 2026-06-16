import type { ReactElement } from 'react'

import Image from 'next/image'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { getTranslations, setRequestLocale } from 'next-intl/server'
import { CalendarRange, Info } from 'lucide-react'

import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { ExperienceCard } from '@/components/experience-card'
import { RegionIntelligenceSections } from '@/components/content/intelligence-sections'
import { ResultsView } from '@/components/maps/results-view'
import { db } from '@/db/client'
import { env } from '@/lib/env'
import { getActivity } from '@/lib/activities/registry'
import { deriveRegionIntelligence } from '@/lib/content/intelligence'
import { loadRegionLanding } from '@/lib/destinations/queries'
import { toMapPins } from '@/lib/maps/pins'
import { getRegionCoords } from '@/lib/maps/region-coords'
import { getRegionImage } from '@/lib/images'
import { getRegion, listRegions } from '@/lib/regions/registry'
import { generateAlternates } from '@/lib/seo/hreflang'
import { breadcrumbList } from '@/lib/seo/schemas/breadcrumb-list'
import { faqPage } from '@/lib/seo/schemas/faq-page'
import { itemList } from '@/lib/seo/schemas/item-list'
import { touristDestination } from '@/lib/seo/schemas/tourist-destination'

export const revalidate = 60

// The region slug space is a CLOSED registry (listRegions()). dynamicParams=false
// makes any slug NOT in the registry 404 at the ROUTING level — before any
// render or stream — the only way to return a TRUE 404 status (a streamed
// loading shell would otherwise flush a 200 that a later notFound() can't
// change). The loading.tsx skeleton stays for VALID slugs. See next/dist/docs
// .../functions/generate-static-params.md.
export const dynamicParams = false

interface PageProps {
  params: Promise<{ locale: string; slug: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

export function generateStaticParams(): Array<{ slug: string }> {
  return listRegions().map((region) => ({ slug: region.slug }))
}

export default async function RegionLandingPage({
  params,
  searchParams,
}: PageProps): Promise<ReactElement> {
  const { locale, slug } = await params
  setRequestLocale(locale)

  const t = await getTranslations({ locale, namespace: 'DestinationsPage' })
  const tCommon = await getTranslations({ locale, namespace: 'Common' })
  const tSearch = await getTranslations({ locale, namespace: 'SearchPage' })
  const tDifficulty = await getTranslations({
    locale,
    namespace: 'ExperiencePage.difficulty',
  })

  const data = await loadRegionLanding(db, slug)
  if (!data) notFound()

  // Issue 22 — data-derived intelligence sections (price range, top activities,
  // nearby same-state destinations, difficulty spread, featured). Empty-safe:
  // sections with no data render nothing.
  const intelligence = await deriveRegionIntelligence(db, slug)

  // `map` is display-only URL state (list/map results toggle, issue 11) — it
  // never affects which Experiences load. Pins are derived from the SAME
  // Experiences shown in the list (region centroid; coordinate honesty D0).
  const rawParams = await searchParams
  const rawMap = Array.isArray(rawParams.map) ? rawParams.map[0] : rawParams.map
  const mapActive = rawMap === '1'
  const pins = toMapPins(
    data.experiences.map((exp) => ({
      slug: exp.slug,
      title: exp.title,
      regionSlug: exp.regionSlug,
      activitySlug: exp.activitySlug,
      pricePerPersonRupees: exp.pricePerParticipantRupees,
    })),
  )

  const baseUrl = env.NEXT_PUBLIC_APP_URL.replace(/\/$/, '')
  const canonicalUrl = `${baseUrl}/destinations/${slug}`
  const regionName = data.region.displayName.en
  const stateName = data.region.state
  const experienceCount = data.experiences.length

  const itemListJson = experienceCount
    ? itemList({
        name: t('detail.itemListName', { region: regionName }),
        items: data.experiences.map((exp) => ({
          name: exp.title,
          url: `${baseUrl}/experience/${exp.slug}`,
          priceRupees: exp.pricePerParticipantRupees,
        })),
      })
    : null

  const breadcrumbsJson = breadcrumbList([
    { name: tCommon('breadcrumb.home'), url: `${baseUrl}/` },
    { name: t('index.breadcrumb'), url: `${baseUrl}/destinations` },
    { name: regionName, url: canonicalUrl },
  ])

  const faqItems = [
    {
      question: t('detail.faqSafetyQuestion', { region: regionName }),
      answer: t('detail.faqSafetyAnswer', { region: regionName }),
    },
    {
      question: t('detail.faqBestTimeQuestion', { region: regionName }),
      answer: t('detail.faqBestTimeAnswer'),
    },
    {
      question: t('detail.faqCancellationQuestion'),
      answer: t('detail.faqCancellationAnswer'),
    },
  ]
  const faqJson = faqPage(faqItems)

  // TouristDestination JSON-LD (ADR-0013). Geo comes from the REAL region
  // centroid (issue 11); when a region has no known centroid the geo block is
  // omitted rather than fabricated (D0). containedInPlace = the Indian state.
  const touristDestinationJson = touristDestination({
    name: regionName,
    description: t('detail.description', { region: regionName, state: stateName }),
    url: canonicalUrl,
    state: stateName,
    geo: getRegionCoords(slug),
  })

  return (
    <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6 lg:py-12">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(touristDestinationJson) }}
      />
      {itemListJson && (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(itemListJson) }}
        />
      )}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbsJson) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(faqJson) }}
      />

      {/* Breadcrumb */}
      <nav aria-label="Breadcrumb" className="mb-6">
        <ol className="flex items-center gap-1.5 text-sm text-muted-foreground">
          <li>
            <Link href="/" className="hover:text-foreground">
              {tCommon('breadcrumb.home')}
            </Link>
          </li>
          <li aria-hidden="true">/</li>
          <li>
            <Link href="/destinations" className="hover:text-foreground">
              {t('index.breadcrumb')}
            </Link>
          </li>
          <li aria-hidden="true">/</li>
          <li className="text-foreground" aria-current="page">
            {regionName}
          </li>
        </ol>
      </nav>

      {/* Hero — region name + state + imagery + description */}
      <header className="mb-[var(--space-section)]">
        <div className="grid items-center gap-8 lg:grid-cols-[1.1fr_1fr]">
          <div>
            <p className="mb-3 text-2xs font-semibold uppercase tracking-[var(--tracking-eyebrow)] text-primary-strong">
              {t('detail.heroEyebrow')}
            </p>
            <h1 className="font-heading text-h1 font-bold tracking-tight text-balance">
              {t('detail.heroTitle', { region: regionName })}
            </h1>
            <p className="mt-2 text-sm font-medium text-muted-foreground">
              {t('detail.heroState', { region: regionName, state: stateName })}
            </p>
            <p className="measure mt-4 text-base text-muted-foreground">
              {t('detail.description', { region: regionName, state: stateName })}
            </p>
          </div>

          <div className="relative aspect-[4/3] overflow-hidden rounded-[var(--radius-card)] shadow-[var(--shadow-md)] lg:aspect-[5/4]">
            <Image
              src={getRegionImage(data.region.slug)}
              alt={regionName}
              fill
              className="object-cover"
              priority
              sizes="(max-width: 1024px) 100vw, 45vw"
            />
          </div>
        </div>
      </header>

      {/* Best time to visit */}
      <section className="mb-[var(--space-section)]">
        <h2 className="mb-2 flex items-center gap-2 font-heading text-h3 font-semibold tracking-tight">
          <CalendarRange className="size-5 shrink-0 text-primary-strong" aria-hidden="true" />
          {t('detail.bestTimeHeading')}
        </h2>
        <p className="measure text-base text-muted-foreground">
          {t('detail.bestTime', { region: regionName })}
        </p>
      </section>

      {/* Experiences grid */}
      <section
        aria-label={t('detail.experiencesHeading', { region: regionName })}
        className="mb-[var(--space-section)]"
      >
        <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="font-heading text-h3 font-semibold tracking-tight">
            {t('detail.experiencesHeading', { region: regionName })}
          </h2>
          {experienceCount > 0 && (
            <span className="text-sm tabular-nums text-muted-foreground">
              {t('detail.experiencesCount', { count: experienceCount })}
            </span>
          )}
        </div>

        {experienceCount > 0 && (
          <Alert variant="info" role="note" className="mb-5">
            <Info aria-hidden="true" />
            <AlertDescription>{t('detail.rankingDisclosure')}</AlertDescription>
          </Alert>
        )}

        {experienceCount === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-[var(--radius-card)] border border-dashed py-16 text-center">
            <p className="text-lg font-medium">
              {t('detail.emptyTitle', { region: regionName })}
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              {t('detail.emptySubtitle')}
            </p>
          </div>
        ) : (
          <ResultsView
            pins={pins}
            mapActive={mapActive}
            labels={{
              list: tSearch('map.list'),
              map: tSearch('map.map'),
              groupLabel: tSearch('map.toggleGroup'),
              viewExperience: tSearch('map.viewExperience'),
              openInMaps: tSearch('map.openInMaps'),
              fromPrice: tSearch('map.fromPrice'),
              cityLevelNote: tSearch('map.cityLevelNote'),
            }}
          >
            <div className="grid gap-[var(--space-grid-gap)] md:grid-cols-2 lg:grid-cols-3">
              {data.experiences.map((exp) => (
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
                    difficulty: exp.difficulty,
                    ratingAvg: exp.ratingAvg,
                    ratingCount: exp.ratingCount,
                    highlight: exp.highlight,
                  }}
                />
              ))}
            </div>
          </ResultsView>
        )}
      </section>

      {/* Data-derived intelligence (issue 22) — empty-safe. */}
      {intelligence && (
        <RegionIntelligenceSections
          data={intelligence}
          labels={{
            priceRangeHeading: t('detail.intelligence.priceRangeHeading'),
            priceRangeValue: ({ minRupees, maxRupees }) =>
              t('detail.intelligence.priceRangeValue', {
                min: minRupees.toLocaleString('en-IN'),
                max: maxRupees.toLocaleString('en-IN'),
              }),
            topActivitiesHeading: t('detail.intelligence.topActivitiesHeading'),
            nearbyHeading: t('detail.intelligence.nearbyHeading'),
            difficultyHeading: t('detail.intelligence.difficultyHeading'),
            featuredHeading: t('detail.intelligence.featuredHeading'),
            difficultyLabel: (difficulty) => tDifficulty(difficulty),
            countChip: (label, count) =>
              t('detail.intelligence.countChip', { label, count }),
            activityName: (s) => getActivity(s)?.displayName.en ?? s,
            regionName: (s) => getRegion(s)?.displayName.en ?? s,
          }}
        />
      )}

      {/* FAQ */}
      <section>
        <h2 className="mb-4 font-heading text-h3 font-semibold tracking-tight">
          {t('detail.faqHeading')}
        </h2>
        <Accordion multiple className="w-full">
          {faqItems.map((item, i) => (
            <AccordionItem key={i} value={`faq-${i}`}>
              <AccordionTrigger className="text-left text-sm font-medium">
                {item.question}
              </AccordionTrigger>
              <AccordionContent className="text-sm text-muted-foreground">
                {item.answer}
              </AccordionContent>
            </AccordionItem>
          ))}
        </Accordion>
      </section>
    </main>
  )
}

export async function generateMetadata({ params }: PageProps) {
  const { locale, slug } = await params
  const data = await loadRegionLanding(db, slug)
  // notFound() here sets the 404 HTTP status pre-stream (generateMetadata
  // resolves before the loading.tsx Suspense shell flushes a 200). See
  // next/dist/docs .../file-conventions/loading.md "Status Codes".
  if (!data) notFound()
  const t = await getTranslations({ locale, namespace: 'DestinationsPage' })
  const regionName = data.region.displayName.en
  const stateName = data.region.state
  return {
    title: t('detail.metadataTitle', { region: regionName }),
    description: t('detail.metadataDescription', {
      region: regionName,
      state: stateName,
    }),
    alternates: generateAlternates(`/destinations/${slug}`, locale),
  }
}
