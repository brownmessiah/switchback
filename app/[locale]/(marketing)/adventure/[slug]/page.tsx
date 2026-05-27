import type { ReactElement } from 'react'

import Image from 'next/image'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { getTranslations, setRequestLocale } from 'next-intl/server'

import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion'
import { ExperienceCard } from '@/components/experience-card'
import { db } from '@/db/client'
import { getActivityImage } from '@/lib/images'
import { env } from '@/lib/env'
import { loadActivityCityCollection } from '@/lib/collections/activity-city-loader'
import { breadcrumbList } from '@/lib/seo/schemas/breadcrumb-list'
import { faqPage } from '@/lib/seo/schemas/faq-page'
import { itemList } from '@/lib/seo/schemas/item-list'

export const revalidate = 60

interface PageProps {
  params: Promise<{ locale: string; slug: string }>
}

export default async function ActivityCityCollectionPage({
  params,
}: PageProps): Promise<ReactElement> {
  const { locale, slug } = await params
  setRequestLocale(locale)

  const t = await getTranslations({ locale, namespace: 'AdventurePage' })
  const tCommon = await getTranslations({ locale, namespace: 'Common' })

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
        name: t('itemList.name', { activity: activityDisplay, region: regionDisplay }),
        items: data.experiences.map((exp) => ({
          name: exp.title,
          url: `${baseUrl}/experience/${exp.slug}`,
          priceRupees: exp.pricePerParticipantRupees,
        })),
      })
    : null
  const breadcrumbsJson = breadcrumbList([
    { name: tCommon('breadcrumb.home'), url: `${baseUrl}/` },
    { name: pageTitle, url: canonicalUrl },
  ])
  const faqItems = [
    {
      question: t('faq.safetyQuestion', { activity: activityDisplay, region: regionDisplay }),
      answer: t('faq.safetyAnswer'),
    },
    {
      question: t('faq.bestTimeQuestion', { activity: activityDisplay, region: regionDisplay }),
      answer: t('faq.bestTimeAnswer'),
    },
    {
      question: t('faq.cancellationQuestion'),
      answer: t('faq.cancellationAnswer'),
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
              {tCommon('breadcrumb.home')}
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
        <div className="relative mb-6 aspect-[3/1] overflow-hidden rounded-2xl">
          <Image
            src={getActivityImage(data.activity.slug)}
            alt={pageTitle}
            fill
            className="object-cover"
            priority
            sizes="100vw"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-black/50 to-transparent" />
          <div className="absolute inset-x-0 bottom-0 p-6">
            <p className="text-lg font-semibold text-white">{pageTitle}</p>
          </div>
        </div>
        <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
          {pageTitle}
        </h1>
        <p className="mt-3 max-w-2xl text-muted-foreground">
          {t('hero.description', { activity: activityDisplay.toLowerCase(), region: regionDisplay })}
        </p>
      </header>

      {/* Experiences grid */}
      <section aria-label={t('experiences.sectionLabel', { activity: activityDisplay })} className="mb-12">
        {data.experiences.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-xl border border-dashed py-16 text-center">
            <p className="text-lg font-medium">
              {t('experiences.emptyTitle', { activity: activityDisplay.toLowerCase(), region: regionDisplay })}
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              {t('experiences.emptySubtitle')}
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
        <h2 className="mb-4 text-xl font-semibold">{t('faq.heading')}</h2>
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
  const { locale, slug } = await params
  const data = await loadActivityCityCollection(db, { lng: 'en', slug })
  if (!data) {
    const tCommon = await getTranslations({ locale, namespace: 'Common' })
    return {
      title: tCommon('notFound'),
      description: '',
      alternates: { canonical: '' },
    }
  }
  const t = await getTranslations({ locale, namespace: 'AdventurePage' })
  const activityDisplay = data.activity.displayName.en
  const regionDisplay = data.region.displayName.en
  const baseUrl = env.NEXT_PUBLIC_APP_URL.replace(/\/$/, '')
  return {
    title: t('metadata.title', { activity: activityDisplay, region: regionDisplay }),
    description: t('metadata.description', { activity: activityDisplay, region: regionDisplay }),
    alternates: {
      canonical: `${baseUrl}/adventure/${slug}`,
    },
  }
}
