import type { ReactElement } from 'react'

import { notFound } from 'next/navigation'

import { db } from '@/db/client'
import { env } from '@/lib/env'
import { loadActivityCityCollection } from '@/lib/collections/activity-city-loader'
import { breadcrumbList } from '@/lib/seo/schemas/breadcrumb-list'
import { faqPage } from '@/lib/seo/schemas/faq-page'
import { itemList } from '@/lib/seo/schemas/item-list'

/**
 * Activity-city collection page per ADR-0013. Server Component, no
 * client-side data fetching — crawlers must see the full product list
 * + JSON-LD on first byte. The discoverable URL pattern Thrillophilia
 * ranks on (`<activity>-in-<city>`) is the highest-leverage SEO surface
 * Outvers has, so this page must be served fully-rendered every time.
 *
 * Order of concerns:
 *   1. Parse + validate the slug via parseActivityCitySlug against the
 *      controlled-vocabulary registries (lib/regions, lib/activities).
 *   2. Load up to 12 published Experiences matching the activity+region.
 *      Empty product list is allowed — the editorial intro alone has
 *      SEO value while inventory fills in.
 *   3. Emit JSON-LD: ItemList of Products, BreadcrumbList, FAQPage.
 *   4. Render the H1 + intro + product cards.
 *
 * The canonical for this page IS itself — sort/filter variants of the
 * collection emit `<link rel='canonical'>` pointing here per ADR-0013.
 *
 * ISR: revalidate every 60s for the data; on-demand revalidation fires
 * when an Experience in scope publishes / unpublishes (M3 webhook).
 *
 * NOTE: This page renders only the SEO scaffolding for M2. The visual
 * polish (hero imagery, FAQ accordion, responsive grid, locale-switched
 * editorial copy) is a Phase-5b follow-up that requires UI verification
 * in a real browser. The Vitest tests on the loader + schema generators
 * cover the data-layer invariants.
 */

export const revalidate = 60

interface PageProps {
  params: Promise<{ lng: string; slug: string }>
}

export default async function ActivityCityCollectionPage({
  params,
}: PageProps): Promise<ReactElement> {
  const { lng, slug } = await params

  const data = await loadActivityCityCollection(db, { lng, slug })
  if (!data) {
    notFound()
  }

  const baseUrl = env.NEXT_PUBLIC_APP_URL.replace(/\/$/, '')
  const collectionPath = `/${lng === 'en' ? '' : `${lng}/`}adventure/${slug}`
  const canonicalUrl = `${baseUrl}${collectionPath}`
  const activityDisplay =
    lng === 'hi' ? data.activity.displayName.hi : data.activity.displayName.en
  const regionDisplay =
    lng === 'hi' ? data.region.displayName.hi : data.region.displayName.en

  const pageTitle = `${activityDisplay} in ${regionDisplay}`

  const itemListJson = data.experiences.length
    ? itemList({
        name: `Top ${activityDisplay} Experiences in ${regionDisplay}`,
        items: data.experiences.map((exp) => ({
          name: exp.title,
          url: `${baseUrl}/${lng}/experience/${exp.slug}`,
          priceRupees: exp.pricePerParticipantRupees,
        })),
      })
    : null

  const breadcrumbsJson = breadcrumbList([
    { name: 'Home', url: `${baseUrl}/${lng === 'en' ? '' : lng}` },
    { name: 'Adventure', url: `${baseUrl}/${lng === 'en' ? '' : `${lng}/`}adventure` },
    { name: pageTitle, url: canonicalUrl },
  ])

  const faqJson = faqPage([
    {
      question: `Is ${activityDisplay} in ${regionDisplay} safe?`,
      answer:
        'All Outvers-listed Experiences are run by KYC-verified Vendors. Safety-stack Experiences require a trusted contact and feature in-trip check-in pings.',
    },
    {
      question: `When is the best time for ${activityDisplay} in ${regionDisplay}?`,
      answer:
        'Refer to each Experience listing for seasonality and region-closure windows. Monsoon and weather closures are surfaced inline at the booking step.',
    },
    {
      question: 'What is the cancellation policy?',
      answer:
        'Each Experience has its own Cancellation policy (Flexible / Moderate / Strict). Refunds for inside-policy cancellations credit to your Outvers wallet within 24 hours.',
    },
  ])

  return (
    <main>
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
      <header>
        <nav aria-label="Breadcrumb">
          <ol>
            <li>
              <a href={`/${lng === 'en' ? '' : lng}`}>Home</a>
            </li>
            <li>
              <a href={`/${lng === 'en' ? '' : `${lng}/`}adventure`}>Adventure</a>
            </li>
            <li aria-current="page">{pageTitle}</li>
          </ol>
        </nav>
        <h1>{pageTitle}</h1>
      </header>

      <section aria-label={`${activityDisplay} Experiences`}>
        {data.experiences.length === 0 ? (
          <p>
            No published {activityDisplay} Experiences in {regionDisplay} yet.
            Check back soon.
          </p>
        ) : (
          <ul>
            {data.experiences.map((exp) => (
              <li key={exp.id}>
                <a
                  href={`/${lng}/experience/${exp.slug}`}
                >
                  <h2>{exp.title}</h2>
                  {exp.shortDescription && <p>{exp.shortDescription}</p>}
                  <p>From ₹{exp.pricePerParticipantRupees} per person</p>
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
  const { lng, slug } = await params
  const data = await loadActivityCityCollection(db, { lng, slug })
  if (!data) {
    return {
      title: 'Not found · Outvers',
      description: '',
      alternates: { canonical: '' },
    }
  }
  const activityDisplay =
    lng === 'hi' ? data.activity.displayName.hi : data.activity.displayName.en
  const regionDisplay =
    lng === 'hi' ? data.region.displayName.hi : data.region.displayName.en
  const baseUrl = env.NEXT_PUBLIC_APP_URL.replace(/\/$/, '')
  return {
    title: `${activityDisplay} in ${regionDisplay} · Outvers`,
    description: `Book ${activityDisplay} Experiences in ${regionDisplay} from KYC-verified Vendors. Transparent pricing, 24-hour refund SLA, real-time slot availability.`,
    alternates: {
      canonical: `${baseUrl}/${lng === 'en' ? '' : `${lng}/`}adventure/${slug}`,
    },
  }
}
