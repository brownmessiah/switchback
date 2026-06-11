'use client'

import type { ReactElement } from 'react'
import { useTranslations } from 'next-intl'
import {
  BadgeCheck,
  CheckCircle2,
  CreditCard,
  ShieldCheck,
  type LucideIcon,
} from 'lucide-react'

/**
 * "Adventure You Can Trust" — compact trust STRIP (owner screenshots,
 * 2026-06-11; was six full cards in issue 08). Headout-style: one slim band
 * directly under the hero so it lands in the first screen, four items with an
 * icon + bold title + one-liner.
 *
 * DECISION D0 (data honesty) still applies: every item is a FEATURE CATEGORY
 * backed by real product behaviour, never a fabricated metric:
 *   - Verified Adventure Vendors → ADR-0007 KYC (Identity / Business verified).
 *   - Transparent Pricing        → ADR-0011 group-size brackets + Partial-pay
 *                                   Advance/balance breakdown shown pre-commit.
 *   - Safety-First Experiences   → safety stack + Trusted-contact NOTIFY
 *                                   (cautious copy: Outvers notifies, it does
 *                                   NOT dispatch — no "guaranteed safety").
 *   - Instant Confirmation       → ADR-0003 every paid Booking confirms instantly.
 *
 * The two dropped cards (Easy Booking Support, Secure Checkout) stay covered
 * by the footer support links and the checkout page itself.
 */

export function HomeTrust(): ReactElement {
  const t = useTranslations('HomePage')

  // Static, pre-resolved label map (no dynamic translation keys — every key is
  // a string literal, so next-intl static analysis still sees them all).
  const ITEMS: ReadonlyArray<{
    key: string
    Icon: LucideIcon
    title: string
    body: string
  }> = [
    {
      key: 'verifiedVendors',
      Icon: BadgeCheck,
      title: t('trust.cards.verifiedVendors.title'),
      body: t('trust.cards.verifiedVendors.body'),
    },
    {
      key: 'transparentPricing',
      Icon: CreditCard,
      title: t('trust.cards.transparentPricing.title'),
      body: t('trust.cards.transparentPricing.body'),
    },
    {
      key: 'safetyFirst',
      Icon: ShieldCheck,
      title: t('trust.cards.safetyFirst.title'),
      body: t('trust.cards.safetyFirst.body'),
    },
    {
      key: 'instantConfirmation',
      Icon: CheckCircle2,
      title: t('trust.cards.instantConfirmation.title'),
      body: t('trust.cards.instantConfirmation.body'),
    },
  ]

  return (
    <section
      aria-labelledby="home-trust-heading"
      className="border-b border-border bg-card"
    >
      <h2 id="home-trust-heading" className="sr-only">
        {t('trust.heading')}
      </h2>
      <ul className="mx-auto grid max-w-6xl grid-cols-1 gap-x-8 gap-y-4 px-4 py-5 sm:grid-cols-2 sm:px-6 lg:grid-cols-4">
        {ITEMS.map(({ key, Icon, title, body }) => (
          <li
            key={key}
            data-testid="trust-card"
            className="flex items-start gap-3"
          >
            <span className="mt-0.5 inline-flex size-8 shrink-0 items-center justify-center rounded-[var(--radius-control)] bg-primary/10 text-primary-strong">
              <Icon className="size-4" aria-hidden="true" />
            </span>
            <div className="min-w-0">
              <h3 className="text-sm font-semibold leading-tight">{title}</h3>
              <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">
                {body}
              </p>
            </div>
          </li>
        ))}
      </ul>
    </section>
  )
}
