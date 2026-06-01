import type { ReactElement } from 'react'

import { headers } from 'next/headers'
import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { getTranslations, setRequestLocale } from 'next-intl/server'
import {
  CircleCheck,
  ShieldCheck,
  Star,
  TriangleAlert,
  Wallet,
} from 'lucide-react'

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
import { WishlistButton } from '@/components/wishlist-button'
import { db } from '@/db/client'
import { reviews, users } from '@/db/schema'
import { auth } from '@/lib/auth'
import { env } from '@/lib/env'
import { isInWishlist } from '@/lib/wishlist/wishlist'
import { loadExperienceDetail } from '@/lib/experiences/detail-loader'
import { getActivityImage } from '@/lib/images'
import { getRedis } from '@/lib/redis'
import { generateAlternates } from '@/lib/seo/hreflang'
import { breadcrumbList } from '@/lib/seo/schemas/breadcrumb-list'
import { faqPage } from '@/lib/seo/schemas/faq-page'
import { product } from '@/lib/seo/schemas/product'
import { reviewList } from '@/lib/seo/schemas/review'

import { AnchorNav, type AnchorNavItem } from './anchor-nav'
import { BookingRail, type BookingRailClosure } from './booking-rail'

export const revalidate = 60

interface PageProps {
  params: Promise<{ locale: string; slug: string }>
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

  // Issue #08 — wishlist saved state for the heart toggle. Logged-out
  // visitors still see the button (initialSaved=false); clicking it routes
  // them to /sign-in (handled client-side in WishlistButton).
  const session = await auth.api.getSession({ headers: await headers() })
  const initialWishlisted = session?.user
    ? await isInWishlist(db, session.user.id, detail.id)
    : false

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
  const kycLabel = kycLabels[kycTier] ?? kycLabels.phone

  // Partial-pay split (ADR-0001) — the Advance is 25% of the lead Group-size
  // bracket price (floored, matching the money-path convention in
  // lib/payments/partial-pay-autocapture.ts), balance is the remainder. Shown
  // prominently in the sticky Booking rail before commit (DESIGN.md §4 B3).
  const partialPayAllowed = detail.paymentModesAllowed.includes('partial_pay')
  const advanceRupees = Math.floor(detail.pricePerPerson_1_2 * 0.25)
  const balanceRupees = detail.pricePerPerson_1_2 - advanceRupees

  // Book-now deep link (unchanged contract): the dedicated checkout page does
  // identity + payment only; slot is carried through when known.
  const checkoutHref = detail.nextAvailableSlotId
    ? `/checkout?experienceId=${detail.id}&slotId=${detail.nextAvailableSlotId}`
    : `/checkout?experienceId=${detail.id}`

  const railClosure: BookingRailClosure | null = detail.activeClosure
    ? {
        heading: t('closure.heading'),
        reason: detail.activeClosure.reason,
        reopens: t('closure.reopens', {
          date: detail.activeClosure.endAt.toLocaleDateString('en-IN', {
            day: 'numeric',
            month: 'long',
            year: 'numeric',
            timeZone: 'UTC',
          }),
        }),
        bookingDisabled: t('closure.bookingDisabled'),
      }
    : null

  // Viator-grade in-page anchor nav (Direction B): only sections present on
  // this Experience get an entry, so the jump always lands somewhere.
  const anchorItems: AnchorNavItem[] = [
    { id: 'overview', label: t('nav.overview') },
    ...(detail.requiredPermits.length > 0
      ? [{ id: 'permits', label: t('nav.permits') }]
      : []),
    { id: 'cancellation', label: t('nav.cancellation') },
    { id: 'reviews', label: t('nav.reviews') },
    { id: 'faq', label: t('nav.faq') },
  ]

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
            <Link href="/" className="hover:text-primary-strong">
              {tCommon('breadcrumb.home')}
            </Link>
          </li>
          <li aria-hidden="true">/</li>
          <li>
            <Link
              href={`/adventure/${detail.activity.slug}-in-${detail.region.slug}`}
              className="hover:text-primary-strong"
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

      {/* Direction B "Conversion-dense sticky-rail" (#65): two-column layout —
          left content column scrolls, right Booking rail stays sticky. On mobile
          the rail stacks inline (and a sticky bottom Book-now bar keeps the CTA
          reachable without trapping the page). */}
      <div className="grid gap-8 lg:grid-cols-[1fr_22rem] lg:gap-12">
        {/* Left column — content */}
        <div className="min-w-0">
          {/* Title + rating-under-title row + Vendor attribution (DESIGN.md
              §4 B2.1–2). */}
          <header className="mb-6">
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <Badge variant="secondary">{activityDisplay}</Badge>
              <Badge variant="outline">{regionDisplay}</Badge>
            </div>
            <h1 className="font-heading text-h1 font-bold tracking-tight text-balance">
              {detail.title}
            </h1>
            <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2 text-sm">
              {aggregateRating && (
                <span className="flex items-center gap-1 font-medium text-foreground">
                  <Star
                    aria-hidden="true"
                    className="size-4 fill-warning text-warning"
                  />
                  <span className="tabular-nums">{aggregateRating.ratingValue}</span>
                  <span className="text-muted-foreground">
                    ·{' '}
                    <span className="tabular-nums">{reviewCount}</span>{' '}
                    {t('rating.reviews', { count: reviewCount })}
                  </span>
                </span>
              )}
              <Link
                href={`/vendor/${detail.vendor.slug}`}
                className="text-muted-foreground hover:text-primary-strong"
              >
                {t('vendor.by', { name: detail.vendor.businessName })}
              </Link>
              <Badge variant="success">
                <ShieldCheck aria-hidden="true" />
                {kycLabel}
              </Badge>
              <WishlistButton
                experienceId={detail.id}
                initialSaved={initialWishlisted}
              />
            </div>
          </header>

          {/* Assurance row (folded in from Direction A) — three trust pillars,
              each on the semantic-status family WITH a paired lucide icon
              (status never by colour alone, DESIGN.md §1.3 / §5). */}
          <ul className="mb-[var(--space-section)] grid gap-3 sm:grid-cols-3">
            <li className="flex items-start gap-2 rounded-[var(--radius-card)] border border-success/20 bg-success-subtle px-3 py-2.5 text-sm text-success">
              <CircleCheck aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
              <span>{t('assurance.freeCancellation')}</span>
            </li>
            <li className="flex items-start gap-2 rounded-[var(--radius-card)] border border-success/20 bg-success-subtle px-3 py-2.5 text-sm text-success">
              <ShieldCheck aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
              <span>{t('assurance.verifiedVendor')}</span>
            </li>
            <li className="flex items-start gap-2 rounded-[var(--radius-card)] border border-info/20 bg-info-subtle px-3 py-2.5 text-sm text-info">
              <Wallet aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
              <span>{t('assurance.exactRefund')}</span>
            </li>
          </ul>

          {/* Viator-grade in-page anchor nav — sticky, links to the section ids
              below. Plain <a href="#…"> (SSR-compatible, no client JS). */}
          <AnchorNav label={t('nav.label')} items={anchorItems} />

          <div className="space-y-[var(--space-section)]">
            {/* Overview — gallery + description (anchor target #overview). */}
            <section
              id="overview"
              className="scroll-mt-[calc(var(--header-offset,4rem)+3.5rem)]"
            >
              <div className="grid grid-cols-2 gap-2 overflow-hidden rounded-[var(--radius-2xl)]">
                <div className="relative col-span-2 aspect-[16/9] sm:col-span-1 sm:aspect-[4/3]">
                  <Image
                    src={detail.gallery[0]?.url ?? getActivityImage(detail.activity.slug)}
                    alt={detail.gallery[0]?.altText ?? detail.title}
                    fill
                    className="object-cover"
                    priority
                    sizes="(max-width: 640px) 100vw, 50vw"
                  />
                </div>
                <div className="hidden gap-2 sm:grid sm:grid-rows-2">
                  <div className="relative overflow-hidden">
                    <Image
                      src={detail.gallery[1]?.url ?? getActivityImage(detail.activity.slug).replace('w=800', 'w=400').replace('fit=crop', 'fit=crop&crop=top')}
                      alt={detail.gallery[1]?.altText ?? ''}
                      fill
                      className="object-cover"
                      sizes="25vw"
                    />
                  </div>
                  <div className="relative overflow-hidden">
                    <Image
                      src={detail.gallery[2]?.url ?? getActivityImage(detail.activity.slug).replace('w=800', 'w=400').replace('fit=crop', 'fit=crop&crop=bottom')}
                      alt={detail.gallery[2]?.altText ?? ''}
                      fill
                      className="object-cover"
                      sizes="25vw"
                    />
                  </div>
                </div>
              </div>

              {detail.shortDescription && (
                <p className="measure mt-6 text-lg leading-relaxed text-foreground">
                  {detail.shortDescription}
                </p>
              )}
              {detail.longDescription && (
                <div className="mt-6">
                  <h2 className="mb-3 font-heading text-h2 font-semibold tracking-tight">
                    {t('sections.about')}
                  </h2>
                  <p className="measure leading-relaxed text-muted-foreground">
                    {detail.longDescription}
                  </p>
                </div>
              )}
            </section>

            {/* Required permits (anchor target #permits) — ADR-0011. */}
            {detail.requiredPermits.length > 0 && (
              <section
                id="permits"
                className="scroll-mt-[calc(var(--header-offset,4rem)+3.5rem)]"
              >
                <h2 className="mb-3 font-heading text-h2 font-semibold tracking-tight">
                  {t('sections.requiredPermits')}
                </h2>
                <div className="rounded-[var(--radius-card)] border border-warning/30 bg-warning-subtle p-4">
                  <p className="mb-3 flex items-start gap-2 text-sm text-warning">
                    <TriangleAlert
                      aria-hidden="true"
                      className="mt-0.5 size-4 shrink-0"
                    />
                    <span>{t('sections.permitsNotice')}</span>
                  </p>
                  <ul className="space-y-1">
                    {detail.requiredPermits.map((permit) => (
                      <li
                        key={permit}
                        className="flex items-center gap-2 text-sm font-medium"
                      >
                        <span className="inline-block h-1.5 w-1.5 rounded-full bg-warning" />
                        {permit.replace(/_/g, ' ')}
                      </li>
                    ))}
                  </ul>
                </div>
              </section>
            )}

            {/* Cancellation policy (anchor target #cancellation) — ADR-0005. */}
            <section
              id="cancellation"
              className="scroll-mt-[calc(var(--header-offset,4rem)+3.5rem)]"
            >
              <h2 className="mb-3 font-heading text-h2 font-semibold tracking-tight">
                {t('sections.cancellationPolicy')}
              </h2>
              <div className="rounded-[var(--radius-card)] border bg-muted/50 p-4">
                <Badge variant="success" className="mb-2 capitalize">
                  <CircleCheck aria-hidden="true" />
                  {detail.cancellationPreset}
                </Badge>
                <p className="text-sm text-muted-foreground">
                  {cancellationDescriptions[detail.cancellationPreset] ??
                    t('cancellation.fallback', { preset: detail.cancellationPreset })}
                </p>
              </div>
            </section>

            {/* Reviews (anchor target #reviews). */}
            <section
              id="reviews"
              className="scroll-mt-[calc(var(--header-offset,4rem)+3.5rem)]"
            >
              <h2 className="mb-4 font-heading text-h2 font-semibold tracking-tight">
                {t('sections.reviews')}
              </h2>
              <ReviewList reviews={experienceReviews} />
            </section>

            {/* FAQ (anchor target #faq). */}
            <section
              id="faq"
              className="scroll-mt-[calc(var(--header-offset,4rem)+3.5rem)]"
            >
              <h2 className="mb-4 font-heading text-h2 font-semibold tracking-tight">
                {t('sections.faq')}
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

          </div>
        </div>

        {/* Right column — the single persistent Booking rail. Desktop: sticky,
            kept permanently in view beside the scrolling content (Direction B).
            Mobile: the two-column grid collapses to one column, so the rail
            stacks inline below the content (reachable, never trapping the page).
            It is rendered exactly once — no duplicate "Book now" / bracket markup
            — so the existing strict-mode E2E selectors stay unambiguous. */}
        <aside
          aria-label={t('pricing.heading')}
          className="lg:sticky lg:top-[calc(var(--header-offset,4rem)+1rem)] lg:self-start"
        >
          <BookingRail
            heading={t('pricing.heading')}
            priceTableLabel={t('pricing.priceTable')}
            brackets={[
              { label: t('pricing.tier1_2'), priceRupees: detail.pricePerPerson_1_2 },
              { label: t('pricing.tier3_5'), priceRupees: detail.pricePerPerson_3_5 },
              { label: t('pricing.tier6Plus'), priceRupees: detail.pricePerPerson_6_plus },
            ]}
            perPersonLabel={t('pricing.perPerson')}
            partialPay={
              partialPayAllowed
                ? {
                    breakdownLabel: t('pricing.breakdown'),
                    notice: t('pricing.partialPay'),
                    advanceLabel: t('pricing.advanceDue'),
                    advanceRupees,
                    balanceLabel: t('pricing.balanceDue'),
                    balanceRupees,
                  }
                : undefined
            }
            freeCancellation={t('pricing.freeCancellation')}
            bookNowLabel={t('pricing.bookNow')}
            checkoutHref={checkoutHref}
            closure={railClosure}
          />
        </aside>
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
