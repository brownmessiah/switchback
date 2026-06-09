import { and, asc, eq, gte, lte, sql } from 'drizzle-orm'

import { availabilitySlots } from '@/db/schema/availability-slots'
import type { ExperienceItineraryStep } from '@/db/schema/experience-itinerary-steps'
import { experiences } from '@/db/schema/experiences'
import { regionClosures } from '@/db/schema/region-closures'
import { slugRedirects } from '@/db/schema/slug-redirects'
import { vendorProfiles } from '@/db/schema/vendor-profiles'
import {
  type ActivityMeta,
  getActivity,
} from '@/lib/activities/registry'
import {
  type GalleryImage,
  loadExperienceGallery,
} from '@/lib/media/experience-images'
import type { DBOrTx } from '@/lib/payments/commission-resolver'
import {
  type PermitMeta,
  resolvePermits,
} from '@/lib/permits/registry'
import {
  type RegionMeta,
  getRegion,
} from '@/lib/regions/registry'

import { loadItinerary } from './itinerary'

export interface ExperienceDetailVendor {
  userId: string
  businessName: string
  slug: string
}

export type ExperienceDetailKycTier = 'phone' | 'identity' | 'business'

/**
 * A Region closure (ADR-0011) overlapping the Experience's bookable window.
 * Surfaced inline at the booking step so customers see e.g.
 * "closed for monsoon — reopens X" instead of a silent empty calendar.
 */
export interface ExperienceActiveClosure {
  reason: string
  startAt: Date
  endAt: Date
  source: 'admin' | 'vendor'
}

export interface ExperienceDetailData {
  id: string
  slug: string
  title: string
  shortDescription: string | null
  longDescription: string | null
  isCombo: boolean
  cancellationPreset: string
  paymentModesAllowed: string[]
  pricePerPerson_1_2: number
  pricePerPerson_3_5: number
  pricePerPerson_6_plus: number
  /**
   * Whether the activity triggers the Safety stack (ADR-0015) — drives the
   * shared "Safety Checked" TrustBadge (issue 05). A listing WITHOUT safety
   * data renders NO Safety Checked badge.
   */
  requiresSafetyStack: boolean
  /** Vendor KYC tier (ADR-0007) — drives the tier-specific Verified Vendor badge. */
  vendorKycTier: ExperienceDetailKycTier
  /** Raw permit slugs as stored on the Experience. */
  requiredPermits: string[]
  /**
   * Resolved permit metadata for the Booking Permits panel (ADR-0011),
   * in the order the Experience listed them. Empty when no permits are
   * required. Unknown slugs are dropped here — see resolvePermits for the
   * separated `unknown` channel when ops needs to flag a stale catalogue.
   */
  permits: PermitMeta[]
  vendor: ExperienceDetailVendor
  activity: ActivityMeta
  region: RegionMeta
  /**
   * Per-listing gallery from `media_assets` (cover first), or `[]` when the
   * Experience has no uploaded media. The PDP renders these when present and
   * falls back to the activity stock photo otherwise (parity-catchup/02).
   */
  gallery: GalleryImage[]
  /**
   * The earliest open Availability slot (capacity remaining) for this
   * Experience, or null when none is bookable. Wired into the Book-now
   * link so the Checkout flow receives a real `slotId` (Issue #13). The
   * rich date/slot picker is the #70 redesign; v1 books the next slot.
   */
  nextAvailableSlotId: string | null
  /**
   * Future bookable slots (open, capacity remaining) within the booking
   * horizon, ascending — power the Booking-rail date picker (#70). Empty when
   * nothing is bookable.
   */
  availableSlots: { id: string; startAt: Date; endAt: Date; remaining: number }[]
  /**
   * A Region closure (ADR-0011) overlapping this Experience's bookable window
   * (now → now + 90d), or null when the region is open. When set, the booking
   * step surfaces the closure reason inline (e.g. "closed for monsoon —
   * reopens X"); the slot materialiser skips the closed dates, so
   * `nextAvailableSlotId` points to the first slot AFTER the closure (if any).
   */
  activeClosure: ExperienceActiveClosure | null

  // ADR-0017 — Structured Experience attributes. Scalars are null when unset;
  // arrays come back as [] when empty (column default '{}'). The integer
  // columns arrive as numbers already (unlike the numeric price columns, which
  // are strings — no Number() conversion needed here).
  /** Total Experience duration in minutes, or null. Format via formatDuration. */
  durationMinutes: number | null
  /** Operational difficulty rating, or null. One of easy/moderate/challenging/extreme. */
  difficulty: string | null
  /** Minimum participant age, or null. */
  minAge: number | null
  /** Operational per-departure cap (distinct from pricing brackets), or null. */
  maxGroupSize: number | null
  /** Guide language codes (subset of KNOWN_GUIDE_LANGUAGES), or [] when unset. */
  languages: string[]
  /** Free-text meeting point, or null. */
  meetingPoint: string | null
  /** Months (1-12) the Experience runs, or [] when unset. Format via formatSeason. */
  seasonMonths: number[]
  /** Marketing highlights (≤6), or [] when unset. */
  highlights: string[]
  /** What's included (≤15), or [] when unset. */
  inclusions: string[]
  /** What's excluded (≤15), or [] when unset. */
  exclusions: string[]
  /** What the Customer should bring (≤15), or [] when unset. */
  whatToBring: string[]
  /**
   * Vendor-authored, per-Experience structured itinerary (ADR-0017), ordered
   * by step_order. DISTINCT from the Customer-led TripGroup itinerary
   * (ADR-0009). Empty when the Experience has no steps.
   */
  itinerary: ExperienceItineraryStep[]
}

export type ExperienceDetailResult =
  | { type: 'found'; lng: string; data: ExperienceDetailData }
  | { type: 'redirect'; lng: string; canonicalSlug: string }

export interface LoadExperienceDetailArgs {
  lng: string
  slug: string
}

export async function loadExperienceDetail(
  db: DBOrTx,
  args: LoadExperienceDetailArgs,
): Promise<ExperienceDetailResult | null> {
  const [exp] = await db
    .select({
      id: experiences.id,
      slug: experiences.slug,
      title: experiences.title,
      shortDescription: experiences.shortDescription,
      longDescription: experiences.longDescription,
      isCombo: experiences.isCombo,
      cancellationPreset: experiences.cancellationPreset,
      paymentModesAllowed: experiences.paymentModesAllowed,
      pricePerPerson_1_2: experiences.pricePerPerson_1_2,
      pricePerPerson_3_5: experiences.pricePerPerson_3_5,
      pricePerPerson_6_plus: experiences.pricePerPerson_6_plus,
      requiresSafetyStack: experiences.requiresSafetyStack,
      requiredPermits: experiences.requiredPermits,
      activitySlug: experiences.activitySlug,
      regionSlug: experiences.regionSlug,
      vendorUserId: experiences.vendorUserId,
      durationMinutes: experiences.durationMinutes,
      difficulty: experiences.difficulty,
      minAge: experiences.minAge,
      maxGroupSize: experiences.maxGroupSize,
      languages: experiences.languages,
      meetingPoint: experiences.meetingPoint,
      seasonMonths: experiences.seasonMonths,
      highlights: experiences.highlights,
      inclusions: experiences.inclusions,
      exclusions: experiences.exclusions,
      whatToBring: experiences.whatToBring,
    })
    .from(experiences)
    .where(
      and(
        eq(experiences.slug, args.slug),
        eq(experiences.status, 'published'),
      ),
    )
    .limit(1)

  if (exp) {
    return hydrateDetail(db, args.lng, exp)
  }

  const [redirect] = await db
    .select({
      entityId: slugRedirects.entityId,
    })
    .from(slugRedirects)
    .where(
      and(
        eq(slugRedirects.oldSlug, args.slug),
        eq(slugRedirects.entityType, 'experience'),
      ),
    )
    .limit(1)

  if (!redirect) return null

  const [target] = await db
    .select({ slug: experiences.slug, status: experiences.status })
    .from(experiences)
    .where(eq(experiences.id, redirect.entityId))
    .limit(1)

  if (!target || target.status !== 'published') return null

  return { type: 'redirect', lng: args.lng, canonicalSlug: target.slug }
}

async function hydrateDetail(
  db: DBOrTx,
  lng: string,
  exp: {
    id: string
    slug: string
    title: string
    shortDescription: string | null
    longDescription: string | null
    isCombo: boolean
    cancellationPreset: string
    paymentModesAllowed: string[]
    pricePerPerson_1_2: string
    pricePerPerson_3_5: string
    pricePerPerson_6_plus: string
    requiresSafetyStack: boolean
    requiredPermits: string[]
    activitySlug: string
    regionSlug: string
    vendorUserId: string
    durationMinutes: number | null
    difficulty: string | null
    minAge: number | null
    maxGroupSize: number | null
    languages: string[] | null
    meetingPoint: string | null
    seasonMonths: number[] | null
    highlights: string[] | null
    inclusions: string[] | null
    exclusions: string[] | null
    whatToBring: string[] | null
  },
): Promise<ExperienceDetailResult> {
  const [vendor] = await db
    .select({
      userId: vendorProfiles.userId,
      businessName: vendorProfiles.businessName,
      slug: vendorProfiles.slug,
      kycTier: vendorProfiles.kycTier,
    })
    .from(vendorProfiles)
    .where(eq(vendorProfiles.userId, exp.vendorUserId))
    .limit(1)

  const activity = getActivity(exp.activitySlug)
  const region = getRegion(exp.regionSlug)

  if (!vendor || !activity || !region) {
    return null as unknown as ExperienceDetailResult
  }

  // Future open slots with capacity remaining — power the Booking-rail date
  // picker (#70); the first is the default Book-now slot (replaces #13's
  // single-slot query). Capped to a sensible horizon.
  const now = new Date()
  const openSlots = await db
    .select({
      id: availabilitySlots.id,
      startAt: availabilitySlots.startAt,
      endAt: availabilitySlots.endAt,
      capacity: availabilitySlots.capacity,
      capacityTaken: availabilitySlots.capacityTaken,
    })
    .from(availabilitySlots)
    .where(
      and(
        eq(availabilitySlots.experienceId, exp.id),
        eq(availabilitySlots.status, 'open'),
        gte(availabilitySlots.startAt, now),
        sql`${availabilitySlots.capacityTaken} < ${availabilitySlots.capacity}`,
      ),
    )
    .orderBy(asc(availabilitySlots.startAt))
    .limit(120)

  // Region closure (ADR-0011) overlapping the bookable window for this
  // Experience's region. The slot materialiser skips every date inside an
  // active closure, so a closure that overlaps [now, now + 90d] is exactly
  // the one that explains a gap in the customer's bookable calendar. We
  // surface it inline ("closed for monsoon — reopens X"). The window mirrors
  // the materialiser's default 90-day horizon. Among overlapping closures we
  // take the soonest-ending so "reopens" reflects the nearest reopening.
  const bookingWindowEnd = new Date(now)
  bookingWindowEnd.setUTCDate(bookingWindowEnd.getUTCDate() + 90)
  const [closure] = await db
    .select({
      reason: regionClosures.reason,
      startAt: regionClosures.startAt,
      endAt: regionClosures.endAt,
      source: regionClosures.source,
    })
    .from(regionClosures)
    .where(
      and(
        eq(regionClosures.regionSlug, exp.regionSlug),
        // Overlaps the booking window: starts before window end AND ends after now.
        lte(regionClosures.startAt, bookingWindowEnd),
        gte(regionClosures.endAt, now),
      ),
    )
    .orderBy(asc(regionClosures.endAt))
    .limit(1)

  const gallery = await loadExperienceGallery(db, exp.id)
  const itinerary = await loadItinerary(db, exp.id)

  return {
    type: 'found',
    lng,
    data: {
      id: exp.id,
      slug: exp.slug,
      title: exp.title,
      shortDescription: exp.shortDescription,
      longDescription: exp.longDescription,
      isCombo: exp.isCombo,
      cancellationPreset: exp.cancellationPreset,
      paymentModesAllowed: exp.paymentModesAllowed,
      pricePerPerson_1_2: Math.floor(Number(exp.pricePerPerson_1_2)),
      pricePerPerson_3_5: Math.floor(Number(exp.pricePerPerson_3_5)),
      pricePerPerson_6_plus: Math.floor(Number(exp.pricePerPerson_6_plus)),
      requiresSafetyStack: exp.requiresSafetyStack,
      vendorKycTier: vendor.kycTier as ExperienceDetailKycTier,
      requiredPermits: exp.requiredPermits,
      permits: resolvePermits(exp.requiredPermits).resolved,
      vendor: {
        userId: vendor.userId,
        businessName: vendor.businessName,
        slug: vendor.slug,
      },
      activity,
      region,
      gallery,
      nextAvailableSlotId: openSlots[0]?.id ?? null,
      availableSlots: openSlots.map((s) => ({
        id: s.id,
        startAt: s.startAt,
        endAt: s.endAt,
        remaining: Math.max(0, s.capacity - s.capacityTaken),
      })),
      activeClosure: closure
        ? {
            reason: closure.reason,
            startAt: closure.startAt,
            endAt: closure.endAt,
            source: closure.source,
          }
        : null,
      durationMinutes: exp.durationMinutes,
      difficulty: exp.difficulty,
      minAge: exp.minAge,
      maxGroupSize: exp.maxGroupSize,
      languages: exp.languages ?? [],
      meetingPoint: exp.meetingPoint,
      seasonMonths: exp.seasonMonths ?? [],
      highlights: exp.highlights ?? [],
      inclusions: exp.inclusions ?? [],
      exclusions: exp.exclusions ?? [],
      whatToBring: exp.whatToBring ?? [],
      itinerary,
    },
  }
}
