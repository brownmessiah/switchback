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
import { listActivities } from '@/lib/activities/registry'
import { loadActivityLanding } from '@/lib/activities/queries'
import { getActivityImage } from '@/lib/images'
import { env } from '@/lib/env'
import { generateAlternates } from '@/lib/seo/hreflang'
import { breadcrumbList } from '@/lib/seo/schemas/breadcrumb-list'
import { faqPage } from '@/lib/seo/schemas/faq-page'
import { itemList } from '@/lib/seo/schemas/item-list'

export const revalidate = 60

interface PageProps {
  params: Promise<{ locale: string; slug: string }>
}

/**
 * `/activities/{slug}` — one activity across ALL regions.
 *
 * Complements `/adventure/{slug}` (activity-IN-city, different content): this
 * page rolls up every published Experience for the activity nationwide. The
 * self-canonical (via generateAlternates) keeps it from competing with the
 * city collection for the same indexing signal.
 */
export function generateStaticParams() {
  return listActivities().map((activity) => ({ slug: activity.slug }))
}

export default async function ActivityLandingPage({
  params,
}: PageProps): Promise<ReactElement> {
  const { locale, slug } = await params
  setRequestLocale(locale)

  const t = await getTranslations({ locale, namespace: 'ActivitiesPage' })
  const tCommon = await getTranslations({ locale, namespace: 'Common' })

  const data = await loadActivityLanding(db, slug)
  if (!data) notFound()

  const baseUrl = env.NEXT_PUBLIC_APP_URL.replace(/\/$/, '')
  const canonicalUrl = `${baseUrl}/activities/${slug}`
  const activityDisplay = data.activity.displayName.en
  const pageTitle = t('heroTitle', { activity: activityDisplay })
  const experienceCount = data.experiences.length

  const itemListJson = experienceCount
    ? itemList({
        name: t('itemList.name', { activity: activityDisplay }),
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
      question: t('faq.safetyQuestion', { activity: activityDisplay }),
      answer: t('faq.safetyAnswer'),
    },
    {
      question: t('faq.regionsQuestion', { activity: activityDisplay }),
      answer: t('faq.regionsAnswer'),
    },
    {
      question: t('faq.cancellationQuestion'),
      answer: t('faq.cancellationAnswer'),
    },
  ]
  const faqJson = faqPage(faqItems)

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

      {/* Editorial hero — refund-forward H1 beside a cinematic image. */}
      <header className="mb-[var(--space-section)]">
        <div className="grid items-center gap-8 lg:grid-cols-[1.1fr_1fr]">
          <div>
            <p className="mb-3 text-2xs font-semibold uppercase tracking-[var(--tracking-eyebrow)] text-primary-strong">
              {t('heroEyebrow')}
            </p>
            <h1 className="font-heading text-h1 font-bold tracking-tight text-balance">
              {pageTitle}
            </h1>
            <p className="measure mt-4 flex items-start gap-2 text-lg text-foreground">
              <XCircle
                className="mt-1 size-5 shrink-0 text-success"
                aria-hidden="true"
              />
              <span>{t('refundLead', { activity: activityDisplay.toLowerCase() })}</span>
            </p>
            <p className="measure mt-3 text-base text-muted-foreground">
              {t('editorialIntro', { activity: activityDisplay.toLowerCase() })}
            </p>

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

      {/* Cross-region experiences grid. */}
      <section
        aria-label={t('experiences.sectionLabel', { activity: activityDisplay })}
        className="mb-[var(--space-section)]"
      >
        <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="font-heading text-h3 font-semibold tracking-tight">
            {t('experiences.heading', { activity: activityDisplay })}
          </h2>
          {experienceCount > 0 && (
            <span className="text-sm tabular-nums text-muted-foreground">
              {t('experiences.count', { count: experienceCount })}
            </span>
          )}
        </div>

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
              {t('experiences.emptyTitle', { activity: activityDisplay.toLowerCase() })}
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
        )}

        <p className="mt-5 text-sm text-muted-foreground">
          {t('regionHint', { activity: activityDisplay.toLowerCase() })}
        </p>
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
  const data = await loadActivityLanding(db, slug)
  if (!data) {
    const tCommon = await getTranslations({ locale, namespace: 'Common' })
    return {
      title: tCommon('notFound'),
      description: '',
      alternates: { canonical: '' },
    }
  }
  const t = await getTranslations({ locale, namespace: 'ActivitiesPage' })
  const activityDisplay = data.activity.displayName.en
  return {
    title: t('metadata.title', { activity: activityDisplay }),
    description: t('metadata.description', { activity: activityDisplay }),
    alternates: generateAlternates(`/activities/${slug}`, locale),
  }
}
