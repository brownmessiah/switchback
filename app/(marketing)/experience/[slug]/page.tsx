import type { ReactElement } from 'react'

import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'

import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion'
import { and, eq } from 'drizzle-orm'

import { ReviewList, type ReviewData } from '@/components/reviews/review-list'
import { Badge } from '@/components/ui/badge'
import { buttonVariants } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'
import { db } from '@/db/client'
import { reviews, users } from '@/db/schema'
import { env } from '@/lib/env'
import { loadExperienceDetail } from '@/lib/experiences/detail-loader'
import { getRedis } from '@/lib/redis'
import { breadcrumbList } from '@/lib/seo/schemas/breadcrumb-list'
import { faqPage } from '@/lib/seo/schemas/faq-page'
import { product } from '@/lib/seo/schemas/product'

export const revalidate = 60

interface PageProps {
  params: Promise<{ slug: string }>
}

const KYC_BADGE: Record<string, { label: string; variant: 'default' | 'secondary' | 'outline' }> = {
  business: { label: 'Business verified', variant: 'default' },
  identity: { label: 'Identity verified', variant: 'secondary' },
  phone: { label: 'Phone verified', variant: 'outline' },
}

const CANCELLATION_DESCRIPTIONS: Record<string, string> = {
  flexible:
    'Free cancellation up to 24 hours before the Experience. 50% refund within 2 hours. No refund after.',
  moderate:
    'Free cancellation up to 7 days before. 50% refund within 48 hours. No refund after.',
  strict: '50% refund up to 7 days before. No refund after.',
}

export default async function ExperienceDetailPage({
  params,
}: PageProps): Promise<ReactElement> {
  const { slug } = await params

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

  const productJson = product({
    name: detail.title,
    url: canonicalUrl,
    description: detail.shortDescription ?? `${activityDisplay} Experience in ${regionDisplay}`,
    priceRupees: detail.pricePerPerson_1_2,
  })
  const breadcrumbsJson = breadcrumbList([
    { name: 'Home', url: `${baseUrl}/` },
    {
      name: `${activityDisplay} in ${regionDisplay}`,
      url: `${baseUrl}/adventure/${detail.activity.slug}-in-${detail.region.slug}`,
    },
    { name: detail.title, url: canonicalUrl },
  ])
  const faqItems = [
    {
      question: `Is ${detail.title} safe?`,
      answer:
        'All Outvers-listed Experiences are run by KYC-verified Vendors. Safety-stack Experiences require a trusted contact and feature in-trip check-in pings.',
    },
    {
      question: `What is the cancellation policy for ${detail.title}?`,
      answer: `This Experience follows the ${detail.cancellationPreset} cancellation policy. Refunds for inside-policy cancellations credit to your Outvers wallet within 24 hours.`,
    },
    {
      question: 'How does payment work?',
      answer: detail.paymentModesAllowed.includes('partial_pay')
        ? 'You can pay 25% now and the rest 24 hours before the Experience starts. Full upfront payment is also available.'
        : 'Full payment is collected at booking time.',
    },
  ]
  const faqJson = faqPage(faqItems)

  const kycBadge = KYC_BADGE.phone

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

      {/* Breadcrumb */}
      <nav aria-label="Breadcrumb" className="mb-6">
        <ol className="flex items-center gap-1.5 text-sm text-muted-foreground">
          <li>
            <Link href="/" className="hover:text-foreground">
              Home
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
          {/* Image placeholder */}
          <div className="grid grid-cols-2 gap-2">
            <div className="col-span-2 aspect-[16/9] rounded-xl bg-muted sm:col-span-1 sm:aspect-[4/3]">
              <div className="flex h-full items-center justify-center text-muted-foreground">
                {activityDisplay}
              </div>
            </div>
            <div className="hidden gap-2 sm:grid sm:grid-rows-2">
              <div className="rounded-xl bg-muted" />
              <div className="rounded-xl bg-muted" />
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
                by {detail.vendor.businessName}
              </Link>
              <Badge variant={kycBadge.variant}>{kycBadge.label}</Badge>
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
              <h2 className="mb-3 text-xl font-semibold">About this experience</h2>
              <p className="leading-relaxed text-muted-foreground">
                {detail.longDescription}
              </p>
            </section>
          )}

          <Separator />

          {/* Cancellation policy */}
          <section>
            <h2 className="mb-3 text-xl font-semibold">Cancellation policy</h2>
            <div className="rounded-lg border bg-muted/50 p-4">
              <Badge variant="secondary" className="mb-2 capitalize">
                {detail.cancellationPreset}
              </Badge>
              <p className="text-sm text-muted-foreground">
                {CANCELLATION_DESCRIPTIONS[detail.cancellationPreset] ??
                  `This Experience follows the ${detail.cancellationPreset} cancellation policy.`}
              </p>
            </div>
          </section>

          {/* Required permits */}
          {detail.requiredPermits.length > 0 && (
            <section>
              <h2 className="mb-3 text-xl font-semibold">Required permits</h2>
              <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4">
                <p className="mb-3 text-sm text-muted-foreground">
                  You need the following permits before participating. Outvers does
                  not obtain permits on your behalf.
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
            <h2 className="mb-4 text-xl font-semibold">Reviews</h2>
            <ReviewList reviews={experienceReviews} />
          </section>

          <Separator />

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
        </div>

        {/* Right column — sticky pricing card */}
        <div className="lg:sticky lg:top-24 lg:self-start">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Pricing</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-3">
                <div className="flex items-baseline justify-between">
                  <span className="text-sm text-muted-foreground">1-2 participants</span>
                  <span className="text-lg font-semibold">
                    ₹{detail.pricePerPerson_1_2.toLocaleString('en-IN')}
                    <span className="ml-1 text-xs font-normal text-muted-foreground">
                      / person
                    </span>
                  </span>
                </div>
                <div className="flex items-baseline justify-between">
                  <span className="text-sm text-muted-foreground">3-5 participants</span>
                  <span className="text-lg font-semibold">
                    ₹{detail.pricePerPerson_3_5.toLocaleString('en-IN')}
                    <span className="ml-1 text-xs font-normal text-muted-foreground">
                      / person
                    </span>
                  </span>
                </div>
                <div className="flex items-baseline justify-between">
                  <span className="text-sm text-muted-foreground">6+ participants</span>
                  <span className="text-lg font-semibold">
                    ₹{detail.pricePerPerson_6_plus.toLocaleString('en-IN')}
                    <span className="ml-1 text-xs font-normal text-muted-foreground">
                      / person
                    </span>
                  </span>
                </div>
              </div>

              <Separator />

              {detail.paymentModesAllowed.includes('partial_pay') && (
                <p className="text-xs text-muted-foreground">
                  Pay 25% now, rest 24h before the experience.
                </p>
              )}

              <Link
                href={`/checkout?experienceId=${detail.id}`}
                className={buttonVariants({ size: 'lg', className: 'w-full' })}
              >
                Book now
              </Link>

              <p className="text-center text-xs text-muted-foreground">
                Free cancellation · 24h refund SLA
              </p>
            </CardContent>
          </Card>
        </div>
      </div>
    </main>
  )
}

export async function generateMetadata({ params }: PageProps): Promise<{
  title: string
  description: string
  alternates: { canonical: string }
}> {
  const { slug } = await params
  const result = await loadExperienceDetail(db, { lng: 'en', slug })

  if (!result || result.type !== 'found') {
    return {
      title: 'Not found · Outvers',
      description: '',
      alternates: { canonical: '' },
    }
  }

  const detail = result.data
  const baseUrl = env.NEXT_PUBLIC_APP_URL.replace(/\/$/, '')
  const activityDisplay = detail.activity.displayName.en
  const regionDisplay = detail.region.displayName.en

  return {
    title: `${detail.title} · ${activityDisplay} in ${regionDisplay} · Outvers`,
    description:
      detail.shortDescription ??
      `Book ${detail.title} in ${regionDisplay} from a KYC-verified Vendor. Transparent pricing, 24-hour refund SLA.`,
    alternates: {
      canonical: `${baseUrl}/experience/${detail.slug}`,
    },
  }
}
