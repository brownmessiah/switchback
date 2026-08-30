'use client'

import type { ReactElement } from 'react'
import { useTranslations } from 'next-intl'
import {
  CalendarClock,
  CreditCard,
  ListChecks,
  Search,
  ShieldCheck,
  type LucideIcon,
} from 'lucide-react'

/**
 * "How Switchback Works" — five sequential steps (issue 08).
 *
 * Maps the real Customer journey, in order:
 *   1. search            → /search keyword + facets.
 *   2. compare           → verified Experiences (KYC, ratings, transparent price).
 *   3. selectSlot        → pick an Availability slot (date & time slot, ADR-0011).
 *   4. paySecurely       → Razorpay checkout, full or Partial-pay Advance (ADR-0008).
 *   5. confirmation      → Instant Confirmation + safety details (ADR-0003 / 0009).
 *
 * Rendered as an <ol> so the sequence is conveyed to assistive tech; the
 * visual numbers are decorative. Steps stack on mobile and lay out across on
 * md+ (no horizontal scroll — ADR-0018).
 */

export function HomeHowItWorks(): ReactElement {
  const t = useTranslations('HomePage')

  // Static, pre-resolved label map (string-literal keys only — no dynamic
  // translation keys).
  const STEPS: ReadonlyArray<{
    key: string
    Icon: LucideIcon
    title: string
    body: string
  }> = [
    {
      key: 'search',
      Icon: Search,
      title: t('howItWorks.steps.search.title'),
      body: t('howItWorks.steps.search.body'),
    },
    {
      key: 'compare',
      Icon: ListChecks,
      title: t('howItWorks.steps.compare.title'),
      body: t('howItWorks.steps.compare.body'),
    },
    {
      key: 'selectSlot',
      Icon: CalendarClock,
      title: t('howItWorks.steps.selectSlot.title'),
      body: t('howItWorks.steps.selectSlot.body'),
    },
    {
      key: 'paySecurely',
      Icon: CreditCard,
      title: t('howItWorks.steps.paySecurely.title'),
      body: t('howItWorks.steps.paySecurely.body'),
    },
    {
      key: 'confirmation',
      Icon: ShieldCheck,
      title: t('howItWorks.steps.confirmation.title'),
      body: t('howItWorks.steps.confirmation.body'),
    },
  ]

  return (
    <section
      aria-labelledby="home-how-it-works-heading"
      className="bg-surface-1"
    >
      <div className="mx-auto max-w-6xl px-4 py-[var(--space-section)] sm:px-6">
        <header className="mb-8 max-w-2xl">
          <h2
            id="home-how-it-works-heading"
            className="font-heading text-h3 font-bold tracking-tight"
          >
            {t('howItWorks.heading')}
          </h2>
          <p className="mt-2 text-base text-muted-foreground">
            {t('howItWorks.subheading')}
          </p>
        </header>

        <ol className="grid grid-cols-1 gap-[var(--space-grid-gap)] sm:grid-cols-2 lg:grid-cols-5">
          {STEPS.map(({ key, Icon, title, body }, index) => (
            <li
              key={key}
              data-testid="how-step"
              className="flex flex-col gap-3 rounded-[var(--radius-card)] bg-surface-0 p-5 shadow-[var(--shadow-sm)] ring-1 ring-foreground/10"
            >
              <div className="flex items-center gap-3">
                <span
                  data-testid="step-number"
                  className="inline-flex size-8 shrink-0 items-center justify-center rounded-full bg-primary text-sm font-semibold tabular-nums text-primary-foreground"
                >
                  {index + 1}
                </span>
                <Icon className="size-5 text-primary-strong" aria-hidden="true" />
              </div>
              <h3
                data-slot="step-title"
                className="font-heading text-base font-semibold"
              >
                {title}
              </h3>
              <p className="text-sm text-muted-foreground">{body}</p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  )
}
