/**
 * Section structure for the public /vendor-partner partner page (issue 06).
 *
 * This pure module is the single source of truth for the page's section
 * ladder and the KYC-tier → documents mapping (ADR-0007). The page
 * (`app/[locale]/(marketing)/vendor-partner/page.tsx`) is a thin
 * presentational consumer: it maps each entry to an i18n key
 * (`VendorPartnerPage.<section>.<item>...`) and renders it.
 *
 * Keeping the structure here (rather than inline in the async server
 * component) makes the ADR-0007 fidelity — tier ladder + the exact
 * "Identity verified" / "Business verified" badge strings — unit-testable
 * without rendering the page.
 *
 * Vocabulary is fixed per CONTEXT.md: Vendor (never operator/host), Payout
 * (never settlement/disbursement), Experience, Booking. "Partner page" is a
 * marketing label only — the role is always Vendor.
 */

/** Bare-path public route for the partner page (English-unprefixed). */
export const VENDOR_PARTNER_PATH = '/vendor-partner' as const

/**
 * The single primary CTA target: the real, auth-gated Vendor onboarding
 * route. The partner page funnels INTO this; it does not replace it.
 */
export const VENDOR_ONBOARDING_HREF = '/vendor/onboarding' as const

/** A leaf content item, addressed by a stable id → i18n key suffix. */
export interface PartnerContentItem {
  /** Stable id; doubles as the i18n key suffix. */
  readonly id: string
  /**
   * For the KYC-tier (documents) items only: the verbatim ADR-0007 badge
   * string, or null where the tier confers no listing badge (Tier 1).
   */
  readonly badge?: string | null
}

export interface PartnerContentSection {
  readonly id: string
  readonly items: readonly PartnerContentItem[]
}

export interface PartnerPageContent {
  readonly sections: readonly PartnerContentSection[]
}

/**
 * The page sections, in render order:
 *   - benefits      — why list on Outvers (online Bookings, Verified Vendor
 *                     badge, dashboard, Payout tracking, visibility)
 *   - whoCanJoin     — who the marketplace is for
 *   - documents      — documents required, mapped to the ADR-0007 KYC tiers
 *   - verification   — the verification process
 *   - bookingPayout  — how Bookings and Payouts flow
 *
 * (The hero is rendered directly by the page; it has no enumerated items.)
 */
export const partnerPageContent: PartnerPageContent = {
  sections: [
    {
      id: 'benefits',
      items: [
        { id: 'onlineBookings' },
        { id: 'verifiedBadge' },
        { id: 'dashboard' },
        { id: 'payoutTracking' },
        { id: 'visibility' },
      ],
    },
    {
      id: 'whoCanJoin',
      items: [{ id: 'rafting' }, { id: 'trekking' }, { id: 'paragliding' }, { id: 'diving' }],
    },
    {
      // Documents required, mapped to the three ADR-0007 KYC tiers. The
      // `badge` field carries the verbatim ADR-0007 badge string (or null
      // for Tier 1, which confers no listing badge).
      id: 'documents',
      items: [
        { id: 'phone', badge: null },
        { id: 'identity', badge: 'Identity verified' },
        { id: 'business', badge: 'Business verified' },
      ],
    },
    {
      id: 'verification',
      items: [{ id: 'phoneStep' }, { id: 'identityStep' }, { id: 'businessStep' }],
    },
    {
      id: 'bookingPayout',
      items: [{ id: 'booking' }, { id: 'partialPay' }, { id: 'payout' }],
    },
  ],
}
