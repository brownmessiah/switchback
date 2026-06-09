import type { ReactElement } from 'react'

import { headers } from 'next/headers'
import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { getTranslations, setRequestLocale } from 'next-intl/server'
import {
  Activity,
  Baby,
  CalendarRange,
  CircleCheck,
  Clock,
  Languages,
  MapPin,
  Star,
  TriangleAlert,
  Users,
  Wallet,
  X,
} from 'lucide-react'

import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion'
import { and, eq } from 'drizzle-orm'

import { loadRecentlyViewedCardsAction } from '@/components/recently-viewed/actions'
import { RecentlyViewedRail } from '@/components/recently-viewed/rail'
import { RecentlyViewedRecorder } from '@/components/recently-viewed/recorder'
import { ReviewList, type ReviewData } from '@/components/reviews/review-list'
import { Badge } from '@/components/ui/badge'
import { WishlistButton } from '@/components/wishlist-button'
import { db } from '@/db/client'
import { reviews, users } from '@/db/schema'
import { auth } from '@/lib/auth'
import { env } from '@/lib/env'
import { isInWishlist } from '@/lib/wishlist/wishlist'
import { loadExperienceDetail } from '@/lib/experiences/detail-loader'
import { formatDuration, formatSeason } from '@/lib/experiences/structured-schema'
import { TrustBadge } from '@/components/trust-badge'
import {
  deriveTrustBadges,
  type CancellationPreset,
  type Difficulty,
  type KycTier,
  type PaymentMode,
} from '@/lib/trust-badges/derive'
import { trustBadgeLabel } from '@/lib/trust-badges/labels'
import { LOCALE_NAMES, type SupportedLocale } from '@/lib/i18n/config'
import { getActivityImage } from '@/lib/images'
import { galleryTiles } from '@/lib/media/experience-images'
import { getRedis } from '@/lib/redis'
import { generateAlternates } from '@/lib/seo/hreflang'
import { breadcrumbList } from '@/lib/seo/schemas/breadcrumb-list'
import { faqPage } from '@/lib/seo/schemas/faq-page'
import { product } from '@/lib/seo/schemas/product'
import { reviewList } from '@/lib/seo/schemas/review'
import { touristTrip } from '@/lib/seo/schemas/trip'

import { AnchorNav, type AnchorNavItem } from './anchor-nav'
import { BookingRail, type BookingRailClosure } from './booking-rail'
import { BookingRailMobile } from './booking-rail-mobile'
import { Gallery, type GalleryImage as GalleryTile } from './gallery'
import {
  ExperienceAfterBooking,
  ExperienceDisclosure,
} from './experience-trust-blocks'

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
  // Root translator for the shared TrustBadges namespace (labels helper passes
  // fully-qualified `TrustBadges.*` keys, shared with the experience card).
  const tRoot = await getTranslations({ locale })

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

  const productDescription =
    detail.shortDescription ?? `${activityDisplay} Experience in ${regionDisplay}`

  // PDP overview gallery (1 large + 2 small). Real media first; missing tiles
  // fall back to DISTINCT activity photos (no crop-duplicates of one image).
  // `galleryImages[0]` remains the canonical hero used for Product JSON-LD + OG.
  const galleryImages = galleryTiles(detail.gallery, detail.activity.slug)

  // Airbnb-style hero+grid: 1 large hero + up to 4 grid tiles. Real media first,
  // then DISTINCT activity fallbacks so a bare listing still shows five varied
  // photos rather than one cropped five ways. These same tiles feed the
  // fullscreen swipeable gallery modal (issue 14). Alt text is honest — real
  // media alt where present, else the Experience title for the hero. We do NOT
  // fabricate per-image labels (D0): the modal shows the title + image counter,
  // no invented Activity/Location categories, since media records carry no
  // per-image label data. The `label` field stays open for when such data lands.
  const galleryTilesForModal: GalleryTile[] = Array.from({ length: 5 }, (_, i) => ({
    url: detail.gallery[i]?.url ?? getActivityImage(detail.activity.slug, i % 3),
    alt: detail.gallery[i]?.altText ?? (i === 0 ? detail.title : detail.title),
  }))

  const productJson = product({
    name: detail.title,
    url: canonicalUrl,
    description: productDescription,
    priceRupees: detail.pricePerPerson_1_2,
    image: galleryImages[0],
    ratingValue: aggregateRating?.ratingValue,
    ratingCount: aggregateRating?.ratingCount,
  })

  // TouristTrip JSON-LD (ADR-0013) — a Trip-shaped view of the structured
  // Experience: ordered itinerary steps + total duration. Emitted only when
  // there is something structured to say (itinerary and/or duration); a bare
  // Experience contributes no Trip node.
  const tripJson =
    detail.itinerary.length > 0 || detail.durationMinutes !== null
      ? touristTrip({
          name: detail.title,
          description: productDescription,
          durationMinutes: detail.durationMinutes,
          itinerary:
            detail.itinerary.length > 0
              ? detail.itinerary.map((step) => ({
                  name: step.title,
                  description: step.description,
                }))
              : undefined,
        })
      : null

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

  /** Pre-resolved difficulty label map — no dynamic keys (mirror kycLabels). */
  const difficultyLabels: Record<string, string> = {
    easy: t('difficulty.easy'),
    moderate: t('difficulty.moderate'),
    challenging: t('difficulty.challenging'),
    extreme: t('difficulty.extreme'),
  }

  // Quick-facts strip (ADR-0017 / DESIGN.md §4 B) — each fact rendered only when
  // its source value is present. Built as a typed list so the render stays a
  // simple map; if the list is empty the whole strip is omitted.
  const languageNames = detail.languages
    .map((code) => LOCALE_NAMES[code as SupportedLocale])
    .filter((name): name is string => Boolean(name))

  const quickFacts: Array<{
    key: string
    icon: typeof Clock
    label: string
    value: string
  }> = [
    ...(detail.durationMinutes !== null
      ? [
          {
            key: 'duration',
            icon: Clock,
            label: t('quickFacts.duration'),
            value: formatDuration(detail.durationMinutes),
          },
        ]
      : []),
    ...(detail.difficulty && difficultyLabels[detail.difficulty]
      ? [
          {
            key: 'difficulty',
            icon: Activity,
            label: t('quickFacts.difficulty'),
            value: difficultyLabels[detail.difficulty]!,
          },
        ]
      : []),
    ...(detail.minAge !== null
      ? [
          {
            key: 'minAge',
            icon: Baby,
            label: t('quickFacts.minAge'),
            value: t('quickFacts.minAgeValue', { age: detail.minAge }),
          },
        ]
      : []),
    ...(detail.maxGroupSize !== null
      ? [
          {
            key: 'groupSize',
            icon: Users,
            label: t('quickFacts.groupSize'),
            value: t('quickFacts.groupSizeValue', { size: detail.maxGroupSize }),
          },
        ]
      : []),
    ...(languageNames.length > 0
      ? [
          {
            key: 'languages',
            icon: Languages,
            label: t('quickFacts.languages'),
            value: languageNames.join(', '),
          },
        ]
      : []),
    ...(detail.seasonMonths.length > 0
      ? [
          {
            key: 'season',
            icon: CalendarRange,
            label: t('quickFacts.season'),
            value: formatSeason(detail.seasonMonths),
          },
        ]
      : []),
  ]

  const hasIncluded = detail.inclusions.length > 0 || detail.exclusions.length > 0

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

  // Data-honest trust badges (issue 05) — derived purely from this listing's
  // real data and rendered via the shared TrustBadge, identical to the cards.
  // Replaces the former hardcoded KYC stub (`kycTier = 'phone'`) and the
  // ad-hoc assurance row. Each badge appears ONLY when its backing data is
  // present — a listing WITHOUT safety data shows NO "Safety Checked" badge.
  const trustBadges = deriveTrustBadges({
    vendorKycTier: detail.vendorKycTier as KycTier,
    requiresSafetyStack: detail.requiresSafetyStack,
    cancellationPreset: detail.cancellationPreset as CancellationPreset,
    difficulty: detail.difficulty as Difficulty | null,
    paymentModesAllowed: detail.paymentModesAllowed as PaymentMode[],
    basePriceRupees: detail.pricePerPerson_1_2,
  })

  // Partial-pay (ADR-0001): the Advance is 25% of the total, balance the
  // remainder at T-24h. The Booking rail computes the split LIVE from the
  // participant-count stepper (booking-rail-interactive.tsx) — the page passes
  // the partial-pay flag + labels only (DESIGN.md §4 B3).
  const partialPayAllowed = detail.paymentModesAllowed.includes('partial_pay')

  // Book-now deep link base: the booking rail appends the date-picker's selected
  // slot id (#70) + participant count. The dedicated checkout page does identity
  // + payment only.
  const checkoutHref = `/checkout?experienceId=${detail.id}`

  // Flatten future slots for the client date + time picker (Date → ISO string).
  const calendarSlots = detail.availableSlots.map((s) => ({
    id: s.id,
    startAtISO: s.startAt.toISOString(),
    endAtISO: s.endAt.toISOString(),
    remaining: s.remaining,
  }))

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
    ...(detail.highlights.length > 0
      ? [{ id: 'highlights', label: t('nav.highlights') }]
      : []),
    ...(detail.itinerary.length > 0
      ? [{ id: 'itinerary', label: t('nav.itinerary') }]
      : []),
    ...(hasIncluded || detail.whatToBring.length > 0
      ? [{ id: 'details', label: t('nav.included') }]
      : []),
    ...(detail.meetingPoint
      ? [{ id: 'meetingPoint', label: t('nav.meetingPoint') }]
      : []),
    ...(detail.requiredPermits.length > 0
      ? [{ id: 'permits', label: t('nav.permits') }]
      : []),
    { id: 'cancellation', label: t('nav.cancellation') },
    { id: 'afterBooking', label: t('nav.afterBooking') },
    { id: 'reviews', label: t('nav.reviews') },
    { id: 'faq', label: t('nav.faq') },
  ]

  // "What happens after booking?" (issue 13) — the 5-step post-booking journey,
  // pre-resolved as an ordered list (string-literal keys; no dynamic keys). The
  // copy carries the load-bearing vocabulary: 25% Advance / Partial pay
  // (ADR-0001), Instant Confirmation (ADR-0003), meeting-point + Vendor-details
  // handover (ADR-0009).
  const afterBookingSteps = [
    t('afterBooking.steps.select'),
    t('afterBooking.steps.payAdvance'),
    t('afterBooking.steps.confirm'),
    t('afterBooking.steps.receive'),
    t('afterBooking.steps.conduct'),
  ]

  // The single, already-computed Booking prop set — consumed verbatim by BOTH
  // the desktop sticky side-rail (`hidden lg:block`) and the mobile bottom-bar
  // → bottom-Sheet (`lg:hidden`). One source of truth: the rail's data is never
  // re-derived per tier (ADR-0018 / DESIGN.md §8.4 PDP-booking lg-only exception).
  const bookingProps = {
    heading: t('pricing.heading'),
    priceTableLabel: t('pricing.priceTable'),
    brackets: [
      { label: t('pricing.tier1_2'), priceRupees: detail.pricePerPerson_1_2 },
      { label: t('pricing.tier3_5'), priceRupees: detail.pricePerPerson_3_5 },
      { label: t('pricing.tier6Plus'), priceRupees: detail.pricePerPerson_6_plus },
    ],
    perPersonLabel: t('pricing.perPerson'),
    participantsLabel: t('pricing.participants'),
    totalLabel: t('pricing.total'),
    maxParticipants: detail.maxGroupSize ?? 12,
    partialPay: partialPayAllowed
      ? {
          breakdownLabel: t('pricing.breakdown'),
          notice: t('pricing.partialPay'),
          advanceLabel: t('pricing.advanceDue'),
          balanceLabel: t('pricing.balanceDue'),
          // Issue 13 — point to the active cancellation preset (ADR-0005)
          // rather than fabricate a refundable rupee figure (which depends on
          // the cancellation timestamp). Plus the ADR-0001 carve-out notice.
          refundablePointer: t('pricing.refundablePointer', {
            preset: detail.cancellationPreset,
          }),
          fullUpfrontNotice: t('pricing.fullUpfront'),
        }
      : undefined,
    freeCancellation: t('pricing.freeCancellation'),
    bookNowLabel: t('pricing.bookNow'),
    checkoutHref,
    slots: calendarSlots,
    locale,
    calendarLabels: {
      selectDate: t('calendar.selectDate'),
      today: t('calendar.today'),
      unavailable: t('calendar.unavailable'),
      selected: t('calendar.selected'),
      prevMonth: t('calendar.prevMonth'),
      nextMonth: t('calendar.nextMonth'),
      noDates: t('calendar.noDates'),
    },
    closure: railClosure,
  }

  return (
    <main className="mx-auto max-w-6xl px-4 py-8 pb-24 sm:px-6 lg:py-12 lg:pb-12">
      {/* Records this PDP into the visitor's recently-viewed list (issue 12) on
          mount — guest-friendly, slug only, no auth / DB write. Renders null. */}
      <RecentlyViewedRecorder slug={detail.slug} />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(productJson) }}
      />
      {tripJson && (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(tripJson) }}
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
          {/* Airbnb-grade hero+grid gallery (1 large hero + a 2×2 grid),
              full content-width above the title (issue 14). Clicking any tile
              opens a fullscreen, swipeable, focus-trapped Dialog (ESC + arrows +
              mobile swipe). Layout/order are unchanged — the markup moved into
              the <Gallery> client island verbatim. On mobile it collapses to a
              single full-bleed hero (the grid is hidden) so the page leads with
              one clean, generous image; the modal then reveals the rest. */}
          <Gallery
            images={galleryTilesForModal}
            title={detail.title}
            totalReal={detail.gallery.length}
          />

          {/* Title + rating-under-title row + Vendor attribution (DESIGN.md
              §4 B2.1–2). A tight Airbnb-style block: location/category eyebrow,
              then the H1, then the rating · vendor · trust line. */}
          <header className="mb-[var(--space-section)]">
            <p className="mb-2 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-sm text-muted-foreground">
              <MapPin aria-hidden="true" className="size-4 shrink-0" />
              <span className="font-medium text-foreground">{activityDisplay}</span>
              <span aria-hidden="true">·</span>
              <span>{regionDisplay}</span>
            </p>
            <h1 className="font-heading text-h1 font-bold tracking-tight text-balance">
              {detail.title}
            </h1>
            <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-2 text-sm">
              {aggregateRating && (
                <>
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
                  <span aria-hidden="true" className="text-border">|</span>
                </>
              )}
              <Link
                href={`/vendor/${detail.vendor.slug}`}
                className="text-muted-foreground hover:text-primary-strong"
              >
                {t('vendor.by', { name: detail.vendor.businessName })}
              </Link>
              <span className="ml-auto">
                <WishlistButton
                  experienceId={detail.id}
                  initialSaved={initialWishlisted}
                />
              </span>
            </div>
          </header>

          {/* Trust badges (issue 05) — the single, data-honest badge row,
              rendered through the SHARED TrustBadge component (identical to the
              experience cards). Each badge appears ONLY when this listing's real
              data backs it (D0); no hardcoded/decorative badge remains. The
              refund-transparency assurance stays as a plain, non-badge signal
              below since it is not a per-listing eligibility badge. */}
          {trustBadges.length > 0 && (
            <ul className="mb-4 flex flex-wrap items-center gap-2">
              {trustBadges.map((badge) => (
                <li key={badge.id}>
                  <TrustBadge id={badge.id} label={trustBadgeLabel(tRoot, badge)} />
                </li>
              ))}
            </ul>
          )}
          <ul className="mb-[var(--space-section)] flex flex-wrap items-center gap-x-5 gap-y-2 text-sm text-foreground">
            <li className="inline-flex items-center gap-1.5">
              <Wallet aria-hidden="true" className="size-4 shrink-0 text-info" />
              <span>{t('assurance.exactRefund')}</span>
            </li>
          </ul>

          {/* Quick-facts strip (ADR-0017) — responsive fact row. Each fact is
              present only when its source value is non-null/non-empty; if NONE
              are present the whole strip is omitted (bare listings unchanged).
              Restyled as a clean hairline-separated card (vertical dividers
              between columns) rather than a filled box — lighter, more scannable,
              Airbnb-grade. */}
          {quickFacts.length > 0 && (
            <dl
              aria-label={t('quickFacts.heading')}
              className="mb-[var(--space-section)] grid grid-cols-2 gap-x-5 gap-y-5 rounded-[var(--radius-card)] border border-border bg-card p-5 md:grid-cols-3"
            >
              {quickFacts.map((fact) => {
                const Icon = fact.icon
                return (
                  // "Stat tile": a tinted icon disc + eyebrow label + a prominent
                  // value. Each tile is self-contained (no cross-column dividers)
                  // so a longer value wraps within its own cell without throwing
                  // the row's baselines off.
                  <div key={fact.key} className="flex items-center gap-3">
                    <span
                      aria-hidden="true"
                      className="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary-strong"
                    >
                      <Icon className="size-4" />
                    </span>
                    <div className="min-w-0">
                      <dt className="text-2xs font-medium uppercase tracking-[var(--tracking-eyebrow)] text-muted-foreground">
                        {fact.label}
                      </dt>
                      <dd className="mt-0.5 text-sm font-semibold leading-snug text-foreground">
                        {fact.value}
                      </dd>
                    </div>
                  </div>
                )
              })}
            </dl>
          )}

          {/* Viator-grade in-page anchor nav — sticky, links to the section ids
              below. Plain <a href="#…"> (SSR-compatible, no client JS). */}
          <AnchorNav label={t('nav.label')} items={anchorItems} />

          {/* Sections — separated by hairline dividers for Airbnb-grade rhythm.
              Each section carries `border-t` (except the first) so the page reads
              as cleanly delineated content blocks with generous vertical space. */}
          <div className="[&>section]:scroll-mt-[calc(var(--header-offset,4rem)+3.5rem)] [&>section]:border-t [&>section]:border-border [&>section]:pt-[var(--space-section)] [&>section]:first:border-t-0 [&>section]:first:pt-0 [&>section:not(:last-child)]:pb-[var(--space-section)]">
            {/* Overview — description (anchor target #overview). */}
            <section id="overview">
              {detail.shortDescription && (
                <p className="measure text-lg leading-relaxed text-foreground">
                  {detail.shortDescription}
                </p>
              )}
              {detail.longDescription && (
                <div className={detail.shortDescription ? 'mt-6' : undefined}>
                  <h2 className="mb-3 font-heading text-h2 font-semibold tracking-tight">
                    {t('sections.about')}
                  </h2>
                  <p className="measure leading-relaxed text-muted-foreground">
                    {detail.longDescription}
                  </p>
                </div>
              )}
            </section>

            {/* Highlights (anchor target #highlights) — ADR-0017. */}
            {detail.highlights.length > 0 && (
              <section id="highlights">
                <h2 className="mb-3 font-heading text-h2 font-semibold tracking-tight">
                  {t('sections.highlights')}
                </h2>
                <ul className="grid gap-2 md:grid-cols-2">
                  {detail.highlights.map((highlight) => (
                    <li key={highlight} className="flex items-start gap-2 text-sm">
                      <CircleCheck
                        aria-hidden="true"
                        className="mt-0.5 size-4 shrink-0 text-success"
                      />
                      <span>{highlight}</span>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {/* Itinerary accordion (anchor target #itinerary) — ADR-0017.
                Vendor-authored, per-Experience steps (DISTINCT from TripGroup
                itinerary). Reuses the FAQ Accordion primitive. */}
            {detail.itinerary.length > 0 && (
              <section id="itinerary">
                <h2 className="mb-4 font-heading text-h2 font-semibold tracking-tight">
                  {t('sections.itinerary')}
                </h2>
                <Accordion multiple className="w-full">
                  {detail.itinerary.map((step, i) => {
                    const dayPrefix =
                      step.dayOffset !== null
                        ? `${t('itinerary.day', { day: step.dayOffset + 1 })} · `
                        : ''
                    return (
                      <AccordionItem key={step.id} value={`itinerary-${i}`}>
                        <AccordionTrigger className="text-left text-sm font-medium">
                          {dayPrefix}
                          {step.title}
                        </AccordionTrigger>
                        <AccordionContent className="space-y-2 text-sm text-muted-foreground">
                          {step.description && <p>{step.description}</p>}
                          {step.durationMinutes !== null && (
                            <p className="flex items-center gap-1.5 text-xs">
                              <Clock aria-hidden="true" className="size-3.5 shrink-0" />
                              {formatDuration(step.durationMinutes)}
                            </p>
                          )}
                        </AccordionContent>
                      </AccordionItem>
                    )
                  })}
                </Accordion>
              </section>
            )}

            {/* Details (anchor target #details) — inclusions / exclusions
                two-column + what-to-bring (ADR-0017). The section renders when
                ANY of the three arrays is non-empty; each block renders only
                when its own array is non-empty. */}
            {(hasIncluded || detail.whatToBring.length > 0) && (
              <section id="details" className="space-y-6">
                {hasIncluded && (
                  <div className="grid gap-6 md:grid-cols-2">
                    {detail.inclusions.length > 0 && (
                      <div>
                        <h2 className="mb-3 font-heading text-h2 font-semibold tracking-tight">
                          {t('sections.included')}
                        </h2>
                        <ul className="space-y-2">
                          {detail.inclusions.map((item) => (
                            <li key={item} className="flex items-start gap-2 text-sm">
                              <CircleCheck
                                aria-hidden="true"
                                className="mt-0.5 size-4 shrink-0 text-success"
                              />
                              <span>{item}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                    {detail.exclusions.length > 0 && (
                      <div>
                        <h2 className="mb-3 font-heading text-h2 font-semibold tracking-tight">
                          {t('sections.excluded')}
                        </h2>
                        <ul className="space-y-2">
                          {detail.exclusions.map((item) => (
                            <li
                              key={item}
                              className="flex items-start gap-2 text-sm text-muted-foreground"
                            >
                              <X aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
                              <span>{item}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                )}
                {detail.whatToBring.length > 0 && (
                  <div>
                    <h2 className="mb-3 font-heading text-h2 font-semibold tracking-tight">
                      {t('sections.whatToBring')}
                    </h2>
                    <ul className="grid gap-2 md:grid-cols-2">
                      {detail.whatToBring.map((item) => (
                        <li key={item} className="flex items-start gap-2 text-sm">
                          <span className="mt-2 inline-block size-1.5 shrink-0 rounded-full bg-muted-foreground" />
                          <span>{item}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </section>
            )}

            {/* Meeting point (anchor target #meetingPoint) — ADR-0017. Text
                only, no map embed in v1. */}
            {detail.meetingPoint && (
              <section id="meetingPoint">
                <h2 className="mb-3 font-heading text-h2 font-semibold tracking-tight">
                  {t('sections.meetingPoint')}
                </h2>
                <p className="flex items-start gap-2 text-sm text-foreground">
                  <MapPin
                    aria-hidden="true"
                    className="mt-0.5 size-4 shrink-0 text-muted-foreground"
                  />
                  <span>{detail.meetingPoint}</span>
                </p>
              </section>
            )}

            {/* Required permits (anchor target #permits) — ADR-0011. */}
            {detail.requiredPermits.length > 0 && (
              <section id="permits">
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
            <section id="cancellation">
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

            {/* Third-party Vendor disclosure (issue 13) — a trust note placed in
                the content flow adjacent to the Booking box (the desktop sticky
                rail sits beside this column; the mobile bottom-bar follows). It
                states, in plain language, that Experiences are operated by
                independent third-party Vendors and what Outvers verifies. The
                NOUN is always "Vendor" (CONTEXT.md). Server-rendered → crawlable
                on every Experience. */}
            <section id="vendorDisclosure">
              <ExperienceDisclosure
                heading={t('disclosure.heading')}
                body={t('disclosure.body')}
              />
            </section>

            {/* "What happens after booking?" (issue 13) — the 5-step journey,
                placed AFTER the booking context (DECISION D11). The component
                owns its own <section id="afterBooking"> so it picks up the
                hairline-divider rhythm + anchor target. Server-rendered <ol> →
                crawlable. */}
            <ExperienceAfterBooking
              heading={t('afterBooking.heading')}
              steps={afterBookingSteps}
            />

            {/* Reviews (anchor target #reviews). */}
            <section id="reviews">
              <h2 className="mb-4 font-heading text-h2 font-semibold tracking-tight">
                {t('sections.reviews')}
              </h2>
              <ReviewList reviews={experienceReviews} />
            </section>

            {/* FAQ (anchor target #faq). */}
            <section id="faq">
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

        {/* Right column — the persistent desktop Booking side-rail. Sticky, kept
            permanently in view beside the scrolling content (Direction B). This
            is the `lg`-only side-rail exception (ADR-0018 / DESIGN.md §8.4): the
            ~22rem decision-complete Card does not dock beside the gallery at
            tablet width, so it is `hidden lg:block` and the mobile/tablet tier
            is served by the bottom-bar → bottom-Sheet below (`lg:hidden`). The
            canonical "Book now" link therefore renders exactly once per tier. */}
        <aside
          id="booking"
          aria-label={bookingProps.heading}
          className="hidden scroll-mt-[calc(var(--header-offset,4rem)+1rem)] lg:block lg:sticky lg:top-[calc(var(--header-offset,4rem)+1rem)] lg:self-start"
        >
          <BookingRail {...bookingProps} />
        </aside>
      </div>

      {/* base + tablet (`< lg`): the sticky booking bottom-bar → bottom-Sheet
          (Foundation D; DESIGN.md §8.5 item 4 / §8.4). The bar shows the
          from-price (lowest bracket) + a CTA opening a bottom Sheet that wraps
          the SAME BookingRailInteractive island — identical `bookingProps`, no
          data refork. `lg:hidden`; the desktop side-rail above covers ≥ lg. */}
      <BookingRailMobile {...bookingProps} />

      {/* RECENTLY VIEWED (issue 12) — the visitor's other recently-viewed
          Experiences, gated through lib/experiences/public-filter and hidden
          when empty. The current PDP self-includes (it was just recorded); that
          is acceptable parity behaviour for a recently-viewed rail. */}
      <RecentlyViewedRail fetchCards={loadRecentlyViewedCardsAction} />
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
