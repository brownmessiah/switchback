import { and, eq } from 'drizzle-orm'

import { experiences } from '@/db/schema/experiences'
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
    },
  }
}
