import type { ReactElement } from 'react'

import Link from 'next/link'
import { notFound } from 'next/navigation'

import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion'
import { ExperienceCard } from '@/components/experience-card'
import { db } from '@/db/client'
import { env } from '@/lib/env'
import { loadActivityCityCollection } from '@/lib/collections/activity-city-loader'
import { breadcrumbList } from '@/lib/seo/schemas/breadcrumb-list'
import { faqPage } from '@/lib/seo/schemas/faq-page'
import { itemList } from '@/lib/seo/schemas/item-list'

export const revalidate = 60

interface PageProps {
  params: Promise<{ slug: string }>
}

export default async function ActivityCityCollectionPage({
  params,
}: PageProps): Promise<ReactElement> {
  const { slug } = await params

  const data = await loadActivityCityCollection(db, { lng: 'en', slug })
  if (!data) notFound()

  const baseUrl = env.NEXT_PUBLIC_APP_URL.replace(/\/$/, '')
  const collectionPath = `/adventure/${slug}`
  const canonicalUrl = `${baseUrl}${collectionPath}`
  const activityDisplay = data.activity.displayName.en
  const regionDisplay = data.region.displayName.en
  const pageTitle = `${activityDisplay} in ${regionDisplay}`

  const itemListJson = data.experiences.length
    ? itemList({
        name: `Top ${activityDisplay} Experiences in ${regionDisplay}`,
        items: data.experiences.map((exp) => ({
          name: exp.title,
          url: `${baseUrl}/experience/${exp.slug}`,
          priceRupees: exp.pricePerParticipantRupees,
        })),
      })
    : null
  const breadcrumbsJson = breadcrumbList([
    { name: 'Home', url: `${baseUrl}/` },
    { name: pageTitle, url: canonicalUrl },
  ])
  const faqItems = [
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
  ]
  const faqJson = faqPage(faqItems)

  return (
    <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6 lg:py-12">
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
              Home
            </Link>
          </li>
          <li aria-hidden="true">/</li>
          <li className="text-foreground" aria-current="page">
            {pageTitle}
          </li>
        </ol>
      </nav>

      {/* Hero */}
      <header className="mb-10">
        <div className="mb-6 aspect-[3/1] overflow-hidden rounded-xl bg-muted">
          <div className="flex h-full items-center justify-center text-lg text-muted-foreground">
            {pageTitle}
          </div>
        </div>
        <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
          {pageTitle}
        </h1>
        <p className="mt-3 max-w-2xl text-muted-foreground">
          Book {activityDisplay.toLowerCase()} experiences in {regionDisplay} from
          KYC-verified vendors. Transparent pricing, real-time slot availability,
          and a 24-hour refund SLA.
        </p>
      </header>

      {/* Experiences grid */}
      <section aria-label={`${activityDisplay} Experiences`} className="mb-12">
        {data.experiences.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-xl border border-dashed py-16 text-center">
            <p className="text-lg font-medium">
              No {activityDisplay.toLowerCase()} experiences in {regionDisplay} yet
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              Check back soon — new listings added regularly.
            </p>
          </div>
        ) : (
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {data.experiences.map((exp) => (
              <ExperienceCard
                key={exp.id}
                experience={{
                  id: exp.id,
                  slug: exp.slug,
                  title: exp.title,
                  shortDescription: exp.shortDescription,
                  pricePerParticipantRupees: exp.pricePerParticipantRupees,
                  regionSlug: data.region.slug,
                  activitySlug: data.activity.slug,
                }}
              />
            ))}
          </div>
        )}
      </section>

      {/* FAQ */}
      <section>
        <h2 className="mb-4 text-xl font-semibold">Frequently asked questions</h2>
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

export async function generateMetadata({ params }: PageProps): Promise<{
  title: string
  description: string
  alternates: { canonical: string }
}> {
  const { slug } = await params
  const data = await loadActivityCityCollection(db, { lng: 'en', slug })
  if (!data) {
    return {
      title: 'Not found · Outvers',
      description: '',
      alternates: { canonical: '' },
    }
  }
  const activityDisplay = data.activity.displayName.en
  const regionDisplay = data.region.displayName.en
  const baseUrl = env.NEXT_PUBLIC_APP_URL.replace(/\/$/, '')
  return {
    title: `${activityDisplay} in ${regionDisplay} · Outvers`,
    description: `Book ${activityDisplay} Experiences in ${regionDisplay} from KYC-verified Vendors. Transparent pricing, 24-hour refund SLA, real-time slot availability.`,
    alternates: {
      canonical: `${baseUrl}/adventure/${slug}`,
    },
  }
}
