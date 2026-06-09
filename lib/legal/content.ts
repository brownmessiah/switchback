/**
 * Single source of truth for the four legal pages (issue 07):
 *   /terms, /privacy, /refund-cancellation, /vendor-terms.
 *
 * These pages are business-safe DRAFTS reflecting the real Outvers model,
 * each carrying a visible "pending final legal review" note (DECISION D7).
 * Counsel reviews before launch.
 *
 * The load-bearing facts live here as typed constants so they are
 * unit-assertable without rendering a page, and so the four pages and the
 * existing /cancellation-policy page can never drift apart:
 *   - CANCELLATION_PRESETS — ADR-0005 (per-Experience, locked at Booking
 *     creation). Flexible / Moderate / Strict.
 *   - REFUND_SLA           — ADR-0004. Wallet (Refund balance) credited
 *     24–48h; cashable to bank in 5–7 working days. The 24–48h is the
 *     WALLET increment, NOT the bank cashout — never over-promise.
 *   - PAYOUT_FACTS         — ADR-0016. Payout (never settlement/
 *     disbursement) net of Commission + GST on commission + TDS, issued
 *     T+7 from Completion; TDS 0.1% under Section 194-O.
 *
 * Vocabulary is fixed per CONTEXT.md: Vendor (never operator), Payout
 * (never settlement/disbursement), Wallet / Refund balance (never
 * "account"), Inside-policy / Flexible cancellation (never "free").
 */

/** The four legal pages, addressed by their bare-path id. */
export type LegalPageId = 'terms' | 'privacy' | 'refund-cancellation' | 'vendor-terms'

/** A legal page's route + i18n namespace, paired so they can't drift. */
export interface LegalPage {
  /** Stable id; matches the bare-path route segment. */
  readonly id: LegalPageId
  /** Bare-path public route (English-unprefixed). */
  readonly path: `/${string}`
  /** PascalCase i18n namespace for this page's copy. */
  readonly namespace: string
}

export const LEGAL_PAGES: readonly LegalPage[] = [
  { id: 'terms', path: '/terms', namespace: 'TermsPage' },
  { id: 'privacy', path: '/privacy', namespace: 'PrivacyPage' },
  {
    id: 'refund-cancellation',
    path: '/refund-cancellation',
    namespace: 'RefundCancellationPage',
  },
  { id: 'vendor-terms', path: '/vendor-terms', namespace: 'VendorTermsPage' },
] as const

/** Bare paths of all four legal pages — exported for the sitemap. */
export const LEGAL_PAGE_PATHS: readonly string[] = LEGAL_PAGES.map((p) => p.path)

/**
 * Shared i18n key, present in every legal namespace, holding the visible
 * "pending final legal review" note (DECISION D7).
 */
export const LEGAL_REVIEW_NOTICE_KEY = 'reviewNotice' as const

/** The existing canonical refund/cancellation reference page (calculator). */
export const CANCELLATION_POLICY_PATH = '/cancellation-policy' as const

/** A single ADR-0005 cancellation preset, with its refund windows. */
export interface CancellationPreset {
  readonly id: 'flexible' | 'moderate' | 'strict'
  /** Latest time before start (T) for a full refund. */
  readonly freeUntil: string
  /** Latest time before start (T) for a 50% refund. */
  readonly halfUntil: string
}

/**
 * ADR-0005 cancellation presets, in display order. Windows are relative to
 * the Experience start time (T). After `halfUntil` there is no refund.
 * Custom presets exist but are admin-approved and rare (omitted here).
 */
export const CANCELLATION_PRESETS: readonly CancellationPreset[] = [
  { id: 'flexible', freeUntil: 'T-24h', halfUntil: 'T-2h' },
  { id: 'moderate', freeUntil: 'T-72h', halfUntil: 'T-24h' },
  { id: 'strict', freeUntil: 'T-14d', halfUntil: 'T-7d' },
] as const

/**
 * ADR-0004 refund SLA. Two distinct windows — keeping them separate is the
 * whole point: the 24–48h is the wallet (Refund balance) increment, the
 * 5–7 working days is the optional bank cashout via Razorpay.
 */
export const REFUND_SLA = {
  /** Wallet (Refund balance) increment after an inside-policy cancellation. */
  walletWindow: '24–48h',
  /** Optional cashout to the original payment method via Razorpay. */
  bankCashoutWindow: '5–7 working days',
} as const

/** ADR-0016 Payout / tax facts (resident-Indian Vendors). */
export const PAYOUT_FACTS = {
  /** TDS rate withheld on gross Booking value. */
  tdsRate: '0.1%',
  /** Income-tax section under which TDS is withheld. */
  tdsSection: '194-O',
  /** Payout timing relative to Booking Completion. */
  payoutTiming: 'T+7',
} as const
