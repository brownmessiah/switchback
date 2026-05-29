import type { ReactElement } from 'react'

import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { getTranslations, setRequestLocale } from 'next-intl/server'

import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion'
import { and, eq } from 'drizzle-orm'
import Image from 'next/image'

import { ReviewList, type ReviewData } from '@/components/reviews/review-list'
import { Badge } from '@/components/ui/badge'
import { buttonVariants } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'
import { db } from '@/db/client'
import { reviews, users } from '@/db/schema'
import { env } from '@/lib/env'
import { loadExperienceDetail } from '@/lib/experiences/detail-loader'
import { getActivityImage } from '@/lib/images'
import { getRedis } from '@/lib/redis'
import { generateAlternates } from '@/lib/seo/hreflang'
import { breadcrumbList } from '@/lib/seo/schemas/breadcrumb-list'
import { faqPage } from '@/lib/seo/schemas/faq-page'
import { product } from '@/lib/seo/schemas/product'
import { reviewList } from '@/lib/seo/schemas/review'

export const revalidate = 60

interface PageProps {
  params: Promise<{ locale: string; slug: string }>
}

/** Pre-resolved KYC badge label map — no dynamic translation keys. */
const KYC_BADGE_VARIANTS: Record<string, 'default' | 'secondary' | 'outline'> = {
  business: 'default',
  identity: 'secondary',
  phone: 'outline',
}

export default async function ExperienceDetailPage({
  params,
}: PageProps): Promise<ReactElement> {
  const { locale, slug } = await params
  setRequestLocale(locale)

  const t = await getTranslations({ locale, namespace: 'ExperiencePage' })
  const tCommon = await getTranslations({ locale, namespace: 'Common' })

  const cacheKey = `slug-redirect:experience:${slug}`
  const redis = getRedis()
  const cachedRedirect = await redis.get(cacheKey)
  if (cachedRedirect) {
    redirect(`/experience/${cachedRedirect}`)
  }

  const result = await loadExperienceDetail(db, { lng: 'en', slug })

  if (!result) notFound()

  if (result.type === 'redirect') {
    await redis.set(cacheKey, result.canonicalSlug, { ex: 24 * 60 * 60 })
    redirect(`/experience/${result.canonicalSlug}`)
  }

  const detail = result.data

  const reviewRows = await db
    .select({
      id: reviews.id,
      rating: reviews.rating,
      title: reviews.title,
      body: reviews.body,
      customerName: users.name,
      createdAt: reviews.createdAt,
    })
    .from(reviews)
    .innerJoin(users, eq(reviews.customerUserId, users.id))
    .where(and(eq(reviews.experienceId, detail.id), eq(reviews.status, 'published')))
    .orderBy(reviews.createdAt)
    .limit(20)

  const experienceReviews: ReviewData[] = reviewRows.map((r) => ({
    id: r.id,
    rating: r.rating,
    title: r.title,
    body: r.body,
    customerName: r.customerName ?? 'Customer',
    createdAt: r.createdAt,
  }))

  const baseUrl = env.NEXT_PUBLIC_APP_URL.replace(/\/$/, '')
  const canonicalUrl = `${baseUrl}/experience/${detail.slug}`
  const activityDisplay = detail.activity.displayName.en
  const regionDisplay = detail.region.displayName.en

  // AggregateRating (ADR-0013) — only when at least one published Review exists.
  const reviewCount = experienceReviews.length
  const aggregateRating =
    reviewCount > 0
      ? {
          ratingValue:
            Math.round(
              (experienceReviews.reduce((sum, r) => sum + r.rating, 0) /
                reviewCount) *
                10,
            ) / 10,
          ratingCount: reviewCount,
        }
      : undefined

  const productJson = product({
    name: detail.title,
    url: canonicalUrl,
    description: detail.shortDescription ?? `${activityDisplay} Experience in ${regionDisplay}`,
    priceRupees: detail.pricePerPerson_1_2,
    ratingValue: aggregateRating?.ratingValue,
    ratingCount: aggregateRating?.ratingCount,
  })

  // Review JSON-LD (ADR-0013) — one node per published Customer review.
  const reviewsJson = reviewList(
    experienceReviews.map((r) => ({
      author: r.customerName,
      rating: r.rating,
      title: r.title,
      body: r.body,
      datePublished: r.createdAt,
    })),
  )
  const breadcrumbsJson = breadcrumbList([
    { name: tCommon('breadcrumb.home'), url: `${baseUrl}/` },
    {
      name: `${activityDisplay} in ${regionDisplay}`,
      url: `${baseUrl}/adventure/${detail.activity.slug}-in-${detail.region.slug}`,
    },
    { name: detail.title, url: canonicalUrl },
  ])

  /** Pre-resolved cancellation description map — no dynamic keys. */
  const cancellationDescriptions: Record<string, string> = {
    flexible: t('cancellation.flexible'),
    moderate: t('cancellation.moderate'),
    strict: t('cancellation.strict'),
  }

  const faqItems = [
    {
      question: t('faq.safetyQuestion', { title: detail.title }),
      answer: t('faq.safetyAnswer'),
    },
    {
      question: t('faq.cancellationQuestion', { title: detail.title }),
      answer: t('faq.cancellationAnswer', { preset: detail.cancellationPreset }),
    },
    {
      question: t('faq.paymentQuestion'),
      answer: detail.paymentModesAllowed.includes('partial_pay')
        ? t('faq.paymentAnswerPartial')
        : t('faq.paymentAnswerFull'),
    },
  ]
  const faqJson = faqPage(faqItems)

  /** Pre-resolved KYC label map — no dynamic keys. */
  const kycLabels: Record<string, string> = {
    business: t('kyc.business'),
    identity: t('kyc.identity'),
    phone: t('kyc.phone'),
  }

  const kycTier = 'phone'
  const kycBadgeVariant = KYC_BADGE_VARIANTS[kycTier] ?? 'outline'
  const kycLabel = kycLabels[kycTier] ?? kycLabels.phone

  return (
    <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6 lg:py-12">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(productJson) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbsJson) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(faqJson) }}
      />
      {reviewsJson.map((reviewJson, i) => (
        <script
          key={`review-jsonld-${i}`}
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(reviewJson) }}
        />
      ))}

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
            <Link
              href={`/adventure/${detail.activity.slug}-in-${detail.region.slug}`}
              className="hover:text-foreground"
            >
              {activityDisplay} in {regionDisplay}
            </Link>
          </li>
          <li aria-hidden="true">/</li>
          <li className="truncate text-foreground" aria-current="page">
            {detail.title}
          </li>
        </ol>
      </nav>

      <div className="grid gap-8 lg:grid-cols-3">
        {/* Left column — details */}
        <div className="space-y-8 lg:col-span-2">
          {/* Image gallery */}
          <div className="grid grid-cols-2 gap-2 overflow-hidden rounded-2xl">
            <div className="relative col-span-2 aspect-[16/9] sm:col-span-1 sm:aspect-[4/3]">
              <Image
                src={getActivityImage(detail.activity.slug)}
                alt={detail.title}
                fill
                className="object-cover"
                priority
                sizes="(max-width: 640px) 100vw, 50vw"
              />
            </div>
            <div className="hidden gap-2 sm:grid sm:grid-rows-2">
              <div className="relative overflow-hidden">
                <Image
                  src={getActivityImage(detail.activity.slug).replace('w=800', 'w=400').replace('fit=crop', 'fit=crop&crop=top')}
                  alt={`${detail.title} detail`}
                  fill
                  className="object-cover"
                  sizes="25vw"
                />
              </div>
              <div className="relative overflow-hidden">
                <Image
                  src={getActivityImage(detail.activity.slug).replace('w=800', 'w=400').replace('fit=crop', 'fit=crop&crop=bottom')}
                  alt={`${detail.title} view`}
                  fill
                  className="object-cover"
                  sizes="25vw"
                />
              </div>
            </div>
          </div>

          {/* Title + vendor */}
          <div>
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <Badge variant="secondary">{activityDisplay}</Badge>
              <Badge variant="outline">{regionDisplay}</Badge>
            </div>
            <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
              {detail.title}
            </h1>
            <div className="mt-3 flex items-center gap-3">
              <Link
                href={`/vendor/${detail.vendor.slug}`}
                className="text-sm text-muted-foreground hover:text-foreground"
              >
                {t('vendor.by', { name: detail.vendor.businessName })}
              </Link>
              <Badge variant={kycBadgeVariant}>{kycLabel}</Badge>
            </div>
          </div>

          {/* Description */}
          {detail.shortDescription && (
            <section>
              <p className="text-base leading-relaxed text-muted-foreground">
                {detail.shortDescription}
              </p>
            </section>
          )}
          {detail.longDescription && (
            <section>
              <h2 className="mb-3 text-xl font-semibold">{t('sections.about')}</h2>
              <p className="leading-relaxed text-muted-foreground">
                {detail.longDescription}
              </p>
            </section>
          )}

          <Separator />

          {/* Cancellation policy */}
          <section>
            <h2 className="mb-3 text-xl font-semibold">{t('sections.cancellationPolicy')}</h2>
            <div className="rounded-lg border bg-muted/50 p-4">
              <Badge variant="secondary" className="mb-2 capitalize">
                {detail.cancellationPreset}
              </Badge>
              <p className="text-sm text-muted-foreground">
                {cancellationDescriptions[detail.cancellationPreset] ??
                  t('cancellation.fallback', { preset: detail.cancellationPreset })}
              </p>
            </div>
          </section>

          {/* Required permits */}
          {detail.requiredPermits.length > 0 && (
            <section>
              <h2 className="mb-3 text-xl font-semibold">{t('sections.requiredPermits')}</h2>
              <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4">
                <p className="mb-3 text-sm text-muted-foreground">
                  {t('sections.permitsNotice')}
                </p>
                <ul className="space-y-1">
                  {detail.requiredPermits.map((permit) => (
                    <li
                      key={permit}
                      className="flex items-center gap-2 text-sm font-medium"
                    >
                      <span className="inline-block h-1.5 w-1.5 rounded-full bg-destructive" />
                      {permit.replace(/_/g, ' ')}
                    </li>
                  ))}
                </ul>
              </div>
            </section>
          )}

          <Separator />

          {/* Reviews */}
          <section>
            <h2 className="mb-4 text-xl font-semibold">{t('sections.reviews')}</h2>
            <ReviewList reviews={experienceReviews} />
          </section>

          <Separator />

          {/* FAQ */}
          <section>
            <h2 className="mb-4 text-xl font-semibold">{t('sections.faq')}</h2>
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
        </div>

        {/* Right column — sticky pricing card */}
        <div className="lg:sticky lg:top-24 lg:self-start">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">{t('pricing.heading')}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-3">
                <div className="flex items-baseline justify-between">
                  <span className="text-sm text-muted-foreground">{t('pricing.tier1_2')}</span>
                  <span className="text-lg font-semibold">
                    ₹{detail.pricePerPerson_1_2.toLocaleString('en-IN')}
                    <span className="ml-1 text-xs font-normal text-muted-foreground">
                      {t('pricing.perPerson')}
                    </span>
                  </span>
                </div>
                <div className="flex items-baseline justify-between">
                  <span className="text-sm text-muted-foreground">{t('pricing.tier3_5')}</span>
                  <span className="text-lg font-semibold">
                    ₹{detail.pricePerPerson_3_5.toLocaleString('en-IN')}
                    <span className="ml-1 text-xs font-normal text-muted-foreground">
                      {t('pricing.perPerson')}
                    </span>
                  </span>
                </div>
                <div className="flex items-baseline justify-between">
                  <span className="text-sm text-muted-foreground">{t('pricing.tier6Plus')}</span>
                  <span className="text-lg font-semibold">
                    ₹{detail.pricePerPerson_6_plus.toLocaleString('en-IN')}
                    <span className="ml-1 text-xs font-normal text-muted-foreground">
                      {t('pricing.perPerson')}
                    </span>
                  </span>
                </div>
              </div>

              <Separator />

              {detail.paymentModesAllowed.includes('partial_pay') && (
                <p className="text-xs text-muted-foreground">
                  {t('pricing.partialPay')}
                </p>
              )}

              {detail.activeClosure ? (
                <>
                  {/* ADR-0011: an active Region closure pauses booking and is
                      surfaced inline (e.g. "closed for monsoon — reopens X"). */}
                  <div
                    role="status"
                    className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm"
                  >
                    <p className="font-medium text-amber-700 dark:text-amber-400">
                      {t('closure.heading')}
                    </p>
                    <p className="mt-1 text-muted-foreground">
                      {detail.activeClosure.reason}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {t('closure.reopens', {
                        date: detail.activeClosure.endAt.toLocaleDateString('en-IN', {
                          day: 'numeric',
                          month: 'long',
                          year: 'numeric',
                          timeZone: 'UTC',
                        }),
                      })}
                    </p>
                  </div>
                  <button
                    type="button"
                    disabled
                    aria-disabled="true"
                    className={buttonVariants({
                      size: 'lg',
                      className: 'w-full cursor-not-allowed opacity-60',
                    })}
                  >
                    {t('pricing.bookNow')}
                  </button>
                  <p className="text-center text-xs text-muted-foreground">
                    {t('closure.bookingDisabled')}
                  </p>
                </>
              ) : (
                <>
                  <Link
                    href={
                      detail.nextAvailableSlotId
                        ? `/checkout?experienceId=${detail.id}&slotId=${detail.nextAvailableSlotId}`
                        : `/checkout?experienceId=${detail.id}`
                    }
                    className={buttonVariants({ size: 'lg', className: 'w-full' })}
                  >
                    {t('pricing.bookNow')}
                  </Link>

                  <p className="text-center text-xs text-muted-foreground">
                    {t('pricing.freeCancellation')}
                  </p>
                </>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </main>
  )
}

export async function generateMetadata({ params }: PageProps) {
  const { locale, slug } = await params
  const result = await loadExperienceDetail(db, { lng: 'en', slug })

  if (!result || result.type !== 'found') {
    const tCommon = await getTranslations({ locale, namespace: 'Common' })
    return {
      title: tCommon('notFound'),
      description: '',
      alternates: { canonical: '' },
    }
  }

  const t = await getTranslations({ locale, namespace: 'ExperiencePage' })
  const detail = result.data
  const activityDisplay = detail.activity.displayName.en
  const regionDisplay = detail.region.displayName.en

  return {
    title: t('metadata.title', { title: detail.title, activity: activityDisplay, region: regionDisplay }),
    description:
      detail.shortDescription ??
      t('metadata.description', { title: detail.title, region: regionDisplay }),
    alternates: generateAlternates(`/experience/${detail.slug}`, locale),
  }
}
