'use client'

import type { ReactElement } from 'react'
import { useTranslations } from 'next-intl'
import {
  BadgeCheck,
  CheckCircle2,
  CreditCard,
  Headset,
  Lock,
  ShieldCheck,
  type LucideIcon,
} from 'lucide-react'

import { Card, CardContent } from '@/components/ui/card'

/**
 * "Adventure You Can Trust" — six descriptive trust cards (issue 08).
 *
 * DECISION D0 (data honesty): every card is a FEATURE CATEGORY backed by real
 * product behaviour, never a fabricated metric:
 *   - Verified Adventure Vendors → ADR-0007 KYC (Identity / Business verified).
 *   - Transparent Pricing        → ADR-0011 group-size brackets + Partial-pay
 *                                   Advance/balance breakdown shown pre-commit.
 *   - Safety-First Experiences   → ADR-0009 safety stack + Trusted-contact
 *                                   NOTIFY (cautious copy: Outvers notifies, it
 *                                   does NOT dispatch — no "guaranteed safety").
 *   - Easy Booking Support       → support@outvers.com (real channel).
 *   - Instant Confirmation       → ADR-0003 every paid Booking confirms instantly.
 *   - Secure Checkout            → ADR-0008 Razorpay-backed payments.
 *
 * Each card pairs a distinct lucide icon with text (status never by colour /
 * icon alone — DESIGN.md §1.3). Cards wrap 1→2→3 columns so there is no
 * horizontal scroll on mobile (ADR-0018).
 */

export function HomeTrust(): ReactElement {
  const t = useTranslations('HomePage')

  // Static, pre-resolved label map (no dynamic translation keys — every key is
  // a string literal, so next-intl static analysis still sees them all).
  const CARDS: ReadonlyArray<{
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
      key: 'bookingSupport',
      Icon: Headset,
      title: t('trust.cards.bookingSupport.title'),
      body: t('trust.cards.bookingSupport.body'),
    },
    {
      key: 'instantConfirmation',
      Icon: CheckCircle2,
      title: t('trust.cards.instantConfirmation.title'),
      body: t('trust.cards.instantConfirmation.body'),
    },
    {
      key: 'secureCheckout',
      Icon: Lock,
      title: t('trust.cards.secureCheckout.title'),
      body: t('trust.cards.secureCheckout.body'),
    },
  ]

  return (
    <section
      aria-labelledby="home-trust-heading"
      className="mx-auto max-w-6xl px-4 py-[var(--space-section)] sm:px-6"
    >
      <header className="mb-8 max-w-2xl">
        <h2
          id="home-trust-heading"
          className="font-heading text-h3 font-bold tracking-tight"
        >
          {t('trust.heading')}
        </h2>
        <p className="mt-2 text-base text-muted-foreground">
          {t('trust.subheading')}
        </p>
      </header>

      <ul className="grid grid-cols-1 gap-[var(--space-grid-gap)] sm:grid-cols-2 lg:grid-cols-3">
        {CARDS.map(({ key, Icon, title, body }) => (
          <li key={key}>
            <Card data-testid="trust-card" className="h-full">
              <CardContent className="flex flex-col gap-2">
                <span className="inline-flex size-10 items-center justify-center rounded-[var(--radius-control)] bg-primary/10 text-primary-strong">
                  <Icon className="size-5" aria-hidden="true" />
                </span>
                <h3 className="font-heading text-base font-semibold">{title}</h3>
                <p className="text-sm text-muted-foreground">{body}</p>
              </CardContent>
            </Card>
          </li>
        ))}
      </ul>
    </section>
  )
}
