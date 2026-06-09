import { eq, inArray } from 'drizzle-orm'

import { experiences } from '@/db/schema/experiences'
import { vendorProfiles } from '@/db/schema/vendor-profiles'
import type { DBOrTx } from '@/lib/payments/commission-resolver'

import type {
  CancellationPreset,
  KycTier,
  PaymentMode,
} from './derive'

/**
 * The per-Experience trust-badge backing fields that card loaders cannot read
 * from their existing selects. Batch-loaded here (one join, no N+1), mirroring
 * loadCardBadgeResolver in lib/experiences/card-badges.ts.
 */
export interface TrustBadgeFields {
  vendorKycTier: KycTier
  requiresSafetyStack: boolean
  cancellationPreset: CancellationPreset
  paymentModesAllowed: PaymentMode[]
}

/**
 * The trust-badge backing fields a card-loader's domain interface mixes in so
 * the spread `...resolveTrust(id)` typechecks. Re-export of TrustBadgeFields
 * under a card-facing name for readability at the interface call sites.
 */
export type CardTrustFields = TrustBadgeFields

/**
 * Safe defaults for an id with no row — a bare card derives only the universal
 * Instant Confirmation badge (ADR-0003).
 */
const DEFAULT_FIELDS: TrustBadgeFields = {
  vendorKycTier: 'phone',
  requiresSafetyStack: false,
  cancellationPreset: 'moderate',
  paymentModesAllowed: [],
}

/**
 * Batch-load the trust-badge backing fields for a set of Experience ids and
 * return a per-id resolver. The Experience → Vendor join supplies the vendor
 * KYC tier alongside the per-Experience safety/cancellation/payment fields, so
 * every card loader can enrich its cards from one call without reshaping rows.
 */
export async function loadTrustBadgeFieldResolver(
  db: DBOrTx,
  experienceIds: string[],
): Promise<(id: string) => TrustBadgeFields> {
  if (experienceIds.length === 0) {
    return () => DEFAULT_FIELDS
  }

  const rows = await db
    .select({
      id: experiences.id,
      requiresSafetyStack: experiences.requiresSafetyStack,
      cancellationPreset: experiences.cancellationPreset,
      paymentModesAllowed: experiences.paymentModesAllowed,
      vendorKycTier: vendorProfiles.kycTier,
    })
    .from(experiences)
    .innerJoin(vendorProfiles, eq(experiences.vendorUserId, vendorProfiles.userId))
    .where(inArray(experiences.id, experienceIds))

  const map = new Map<string, TrustBadgeFields>()
  for (const r of rows) {
    map.set(r.id, {
      vendorKycTier: r.vendorKycTier as KycTier,
      requiresSafetyStack: r.requiresSafetyStack,
      cancellationPreset: r.cancellationPreset as CancellationPreset,
      paymentModesAllowed: r.paymentModesAllowed as PaymentMode[],
    })
  }

  return (id: string): TrustBadgeFields => map.get(id) ?? DEFAULT_FIELDS
}
