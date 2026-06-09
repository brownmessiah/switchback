/**
 * `lib/trust-badges` — the single, data-honest badge derivation (D0).
 *
 * Given a listing's REAL data, `deriveTrustBadges` returns the ordered set of
 * applicable TrustBadges from the canonical vocabulary. A badge is included
 * ONLY when that listing's backing data is present — badges are never
 * decoration. The same pure function feeds both the experience card and the
 * PDP, so the two surfaces can never drift.
 *
 * Domain vocabulary (load-bearing — see CONTEXT.md / docs/adr):
 *   - Verified Vendor — KYC tier ≥ Identity verified (ADR-0007). The label is
 *     tier-specific: "Identity verified" / "Business verified". NEVER "operator".
 *   - Safety Checked — the activity triggers the Safety stack (ADR-0015).
 *   - Instant Confirmation — every paid Booking confirms instantly (ADR-0003),
 *     so this is universally eligible.
 *   - Partial Payment Available — the Experience offers partial pay (ADR-0001)
 *     and its base price is within the Rs.25,000 escrow carve-out.
 *   - Flexible cancellation — the Flexible preset (ADR-0005). NEVER "free".
 *   - Beginner Friendly — the easy difficulty tier (ADR-0017).
 *
 * "Popular Choice" is NOT derived here. It reuses the existing social-proof
 * `highlight` signal (deriveHighlight in lib/experiences/card-badges.ts), which
 * is rendered as a distinct earned image overlay on the card. trust-badges owns
 * the trust dimension; the popularity computation is not reinvented.
 */

export type TrustBadgeId =
  | 'verified-vendor'
  | 'safety-checked'
  | 'instant-confirmation'
  | 'partial-pay'
  | 'flexible-cancellation'
  | 'beginner-friendly'

/** A derived, render-ready badge. `labelKey` is resolved by the i18n layer. */
export interface TrustBadge {
  id: TrustBadgeId
  /** Dot-notation key under the `TrustBadges` message namespace. */
  labelKey: string
}

export type KycTier = 'phone' | 'identity' | 'business'
export type CancellationPreset = 'flexible' | 'moderate' | 'strict' | 'custom'
export type Difficulty = 'easy' | 'moderate' | 'challenging' | 'extreme'
export type PaymentMode = 'full_upfront' | 'partial_pay' | 'reserve_now_pay_later'

/**
 * The minimal slice of an Experience's real data needed to derive its trust
 * badges. Plain data (no DB row) so the derivation stays trivially testable and
 * reusable from card loaders and the detail loader alike.
 */
export interface TrustBadgeInput {
  /** Vendor KYC tier (ADR-0007). */
  vendorKycTier: KycTier
  /** Whether the activity triggers the Safety stack (ADR-0015). */
  requiresSafetyStack: boolean
  /** Cancellation policy preset (ADR-0005). */
  cancellationPreset: CancellationPreset
  /** Operational difficulty (ADR-0017), or null when unset. */
  difficulty: Difficulty | null
  /** Payment modes the Experience accepts (ADR-0001/0002). */
  paymentModesAllowed: PaymentMode[]
  /** Lowest per-person price bracket in rupees (ADR-0011). */
  basePriceRupees: number
}

/**
 * Above this ticket value partial-pay defaults to an escrow-flavoured 100%
 * capture (ADR-0001 carve-out), so the listing-level "Partial Payment
 * Available" badge does not apply.
 */
const PARTIAL_PAY_ESCROW_THRESHOLD_RUPEES = 25_000

/** KYC tiers at/above "Identity verified" earn the Verified Vendor badge. */
const VERIFIED_KYC_TIERS: ReadonlySet<KycTier> = new Set(['identity', 'business'])

/**
 * Derive the ordered set of TrustBadges a listing's data backs. The order is
 * the canonical vocabulary order; absent backing data simply omits the badge.
 */
export function deriveTrustBadges(input: TrustBadgeInput): TrustBadge[] {
  const badges: TrustBadge[] = []

  // Verified Vendor — tier-specific label (never "operator"). ADR-0007.
  if (VERIFIED_KYC_TIERS.has(input.vendorKycTier)) {
    badges.push({
      id: 'verified-vendor',
      labelKey:
        input.vendorKycTier === 'business'
          ? 'verifiedVendor.business'
          : 'verifiedVendor.identity',
    })
  }

  // Safety Checked — only when the activity triggers the Safety stack. ADR-0015.
  if (input.requiresSafetyStack) {
    badges.push({ id: 'safety-checked', labelKey: 'safetyChecked' })
  }

  // Instant Confirmation — universal (ADR-0003).
  badges.push({ id: 'instant-confirmation', labelKey: 'instantConfirmation' })

  // Partial Payment Available — offered AND within the Rs.25,000 carve-out.
  if (
    input.paymentModesAllowed.includes('partial_pay') &&
    input.basePriceRupees <= PARTIAL_PAY_ESCROW_THRESHOLD_RUPEES
  ) {
    badges.push({ id: 'partial-pay', labelKey: 'partialPay' })
  }

  // Flexible cancellation — the Flexible preset only (never "free"). ADR-0005.
  if (input.cancellationPreset === 'flexible') {
    badges.push({ id: 'flexible-cancellation', labelKey: 'flexibleCancellation' })
  }

  // Beginner Friendly — the easy difficulty tier. ADR-0017.
  if (input.difficulty === 'easy') {
    badges.push({ id: 'beginner-friendly', labelKey: 'beginnerFriendly' })
  }

  return badges
}
