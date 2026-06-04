import type { ReactElement } from 'react'

import Image from 'next/image'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { getTranslations, setRequestLocale } from 'next-intl/server'
import { BadgeCheck, Info, ShieldCheck, XCircle } from 'lucide-react'

import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { ExperienceCard } from '@/components/experience-card'
import { db } from '@/db/client'
import { getActivityImage } from '@/lib/images'
import { env } from '@/lib/env'
import { loadActivityCityCollection } from '@/lib/collections/activity-city-loader'
import { generateAlternates } from '@/lib/seo/hreflang'
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
  // SEO/page title stays "{activity} in {region}" — JSON-LD, breadcrumb trail
  // (and the existing E2E selectors) depend on it. The refund-forward headline
  // (variant A) is rendered as the visible H1 separately.
  const pageTitle = `${activityDisplay} in ${regionDisplay}`
  const heroTitle = t('heroTitle', {
    activity: activityDisplay,
    region: regionDisplay,
  })
  const experienceCount = data.experiences.length

  const itemListJson = experienceCount
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

  // Trust band (variant A) — three refund-forward pillars on the semantic-status
  // family, each paired with a lucide icon (status never by colour alone, §1.3 /
  // §5). success = Free-cancellation + Identity-verified Vendor; info = refund SLA.
  const trustPillars = [
    {
      key: 'freeCancellation',
      Icon: XCircle,
      label: t('trust.freeCancellation'),
      variant: 'success' as const,
    },
    {
      key: 'verifiedVendor',
      Icon: ShieldCheck,
      label: t('trust.verifiedVendor'),
      variant: 'success' as const,
    },
    {
      key: 'refundSla',
      Icon: BadgeCheck,
      label: t('trust.refundSla'),
      variant: 'info' as const,
    },
  ]

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

      {/* Editorial hero (variant A) — magazine-grade SEO landing where the refund
          promise is the headline. Eyebrow → refund-forward H1 (display face) →
          measure-capped editorial lead, beside a cinematic image. */}
      <header className="mb-[var(--space-section)]">
        <div className="grid items-center gap-8 lg:grid-cols-[1.1fr_1fr]">
          <div>
            <p className="mb-3 text-2xs font-semibold uppercase tracking-[var(--tracking-eyebrow)] text-primary-strong">
              {t('heroEyebrow')}
            </p>
            <h1 className="font-heading text-h1 font-bold tracking-tight text-balance">
              {heroTitle}
            </h1>
            {/* Refund promise as the lead — success framing + check icon. */}
            <p className="measure mt-4 flex items-start gap-2 text-lg text-foreground">
              <XCircle
                className="mt-1 size-5 shrink-0 text-success"
                aria-hidden="true"
              />
              <span>{t('refundLead', { activity: activityDisplay.toLowerCase(), region: regionDisplay })}</span>
            </p>
            <p className="measure mt-3 text-base text-muted-foreground">
              {t('editorialIntro', { activity: activityDisplay.toLowerCase(), region: regionDisplay })}
            </p>

            {/* Trust band — three pillars on the semantic-status family. */}
            <ul className="mt-6 flex flex-wrap items-center gap-2">
              {trustPillars.map(({ key, Icon, label, variant }) => (
                <li key={key}>
                  <Badge variant={variant} className="h-7 px-3 py-1 text-xs">
                    <Icon aria-hidden="true" />
                    {label}
                  </Badge>
                </li>
              ))}
            </ul>
          </div>

          <div className="relative aspect-[4/3] overflow-hidden rounded-[var(--radius-card)] shadow-[var(--shadow-md)] lg:aspect-[5/4]">
            <Image
              src={getActivityImage(data.activity.slug)}
              alt={pageTitle}
              fill
              className="object-cover"
              priority
              sizes="(max-width: 1024px) 100vw, 45vw"
            />
          </div>
        </div>
      </header>

      {/* Experiences grid — one ranked, decision-complete A1-card grid. */}
      <section
        aria-label={t('experiences.sectionLabel', { activity: activityDisplay })}
        className="mb-[var(--space-section)]"
      >
        <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="font-heading text-h3 font-semibold tracking-tight">
            {t('experiences.heading', { activity: activityDisplay, region: regionDisplay })}
          </h2>
          {experienceCount > 0 && (
            <span className="text-sm tabular-nums text-muted-foreground">
              {t('experiences.count', { count: experienceCount })}
            </span>
          )}
        </div>

        {/* Mandatory B1 ranking-transparency disclosure ("How we rank"), --info. */}
        {experienceCount > 0 && (
          <Alert variant="info" role="note" className="mb-5">
            <Info aria-hidden="true" />
            <AlertDescription>
              {t('experiences.rankingDisclosure')}
            </AlertDescription>
          </Alert>
        )}

        {experienceCount === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-[var(--radius-card)] border border-dashed py-16 text-center">
            <p className="text-lg font-medium">
              {t('experiences.emptyTitle', { activity: activityDisplay.toLowerCase(), region: regionDisplay })}
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              {t('experiences.emptySubtitle')}
            </p>
          </div>
        ) : (
          <div className="grid gap-[var(--space-grid-gap)] sm:grid-cols-2 lg:grid-cols-3">
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
                  coverImageUrl: exp.coverImageUrl,
                  difficulty: exp.difficulty,
                  ratingAvg: exp.ratingAvg,
                  ratingCount: exp.ratingCount,
                  highlight: exp.highlight,
                }}
              />
            ))}
          </div>
        )}
      </section>

      {/* FAQ */}
      <section>
        <h2 className="mb-4 font-heading text-h3 font-semibold tracking-tight">
          {t('faq.heading')}
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
  return {
    title: t('metadata.title', { activity: activityDisplay, region: regionDisplay }),
    description: t('metadata.description', { activity: activityDisplay, region: regionDisplay }),
    alternates: generateAlternates(`/adventure/${slug}`, locale),
  }
}
