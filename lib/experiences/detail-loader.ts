import { and, asc, eq, gte, lte, sql } from 'drizzle-orm'

import { availabilitySlots } from '@/db/schema/availability-slots'
import { experiences } from '@/db/schema/experiences'
import { regionClosures } from '@/db/schema/region-closures'
import { slugRedirects } from '@/db/schema/slug-redirects'
import { vendorProfiles } from '@/db/schema/vendor-profiles'
import {
  type ActivityMeta,
  getActivity,
} from '@/lib/activities/registry'
import type { DBOrTx } from '@/lib/payments/commission-resolver'
import {
  type PermitMeta,
  resolvePermits,
} from '@/lib/permits/registry'
import {
  type RegionMeta,
  getRegion,
} from '@/lib/regions/registry'

export interface ExperienceDetailVendor {
  userId: string
  businessName: string
  slug: string
}

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
   * The earliest open Availability slot (capacity remaining) for this
   * Experience, or null when none is bookable. Wired into the Book-now
   * link so the Checkout flow receives a real `slotId` (Issue #13). The
   * rich date/slot picker is the #70 redesign; v1 books the next slot.
   */
  nextAvailableSlotId: string | null
  /**
   * A Region closure (ADR-0011) overlapping this Experience's bookable window
   * (now → now + 90d), or null when the region is open. When set, the booking
   * step surfaces the closure reason inline (e.g. "closed for monsoon —
   * reopens X"); the slot materialiser skips the closed dates, so
   * `nextAvailableSlotId` points to the first slot AFTER the closure (if any).
   */
  activeClosure: ExperienceActiveClosure | null
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
      requiredPermits: experiences.requiredPermits,
      activitySlug: experiences.activitySlug,
      regionSlug: experiences.regionSlug,
      vendorUserId: experiences.vendorUserId,
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
    requiredPermits: string[]
    activitySlug: string
    regionSlug: string
    vendorUserId: string
  },
): Promise<ExperienceDetailResult> {
  const [vendor] = await db
    .select({
      userId: vendorProfiles.userId,
      businessName: vendorProfiles.businessName,
      slug: vendorProfiles.slug,
    })
    .from(vendorProfiles)
    .where(eq(vendorProfiles.userId, exp.vendorUserId))
    .limit(1)

  const activity = getActivity(exp.activitySlug)
  const region = getRegion(exp.regionSlug)

  if (!vendor || !activity || !region) {
    return null as unknown as ExperienceDetailResult
  }

  // Earliest open slot with capacity remaining — drives the Book-now link
  // so Checkout gets a real slotId (Issue #13).
  const [nextSlot] = await db
    .select({ id: availabilitySlots.id })
    .from(availabilitySlots)
    .where(
      and(
        eq(availabilitySlots.experienceId, exp.id),
        eq(availabilitySlots.status, 'open'),
        sql`${availabilitySlots.capacityTaken} < ${availabilitySlots.capacity}`,
      ),
    )
    .orderBy(asc(availabilitySlots.startAt))
    .limit(1)

  // Region closure (ADR-0011) overlapping the bookable window for this
  // Experience's region. The slot materialiser skips every date inside an
  // active closure, so a closure that overlaps [now, now + 90d] is exactly
  // the one that explains a gap in the customer's bookable calendar. We
  // surface it inline ("closed for monsoon — reopens X"). The window mirrors
  // the materialiser's default 90-day horizon. Among overlapping closures we
  // take the soonest-ending so "reopens" reflects the nearest reopening.
  const now = new Date()
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
      requiredPermits: exp.requiredPermits,
      permits: resolvePermits(exp.requiredPermits).resolved,
      vendor,
      activity,
      region,
      nextAvailableSlotId: nextSlot?.id ?? null,
      activeClosure: closure
        ? {
            reason: closure.reason,
            startAt: closure.startAt,
            endAt: closure.endAt,
            source: closure.source,
          }
        : null,
    },
  }
}
