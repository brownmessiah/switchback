import type { Metadata } from 'next'
import Link from 'next/link'
import type { ReactElement } from 'react'
import {
  Compass,
  CalendarCheck,
  BadgeCheck,
  LayoutDashboard,
  Wallet,
  Search,
  Phone,
  IdCard,
  Building2,
  Waves,
  Mountain,
  Wind,
  Anchor,
} from 'lucide-react'
import { getTranslations, setRequestLocale } from 'next-intl/server'

import { env } from '@/lib/env'
import { generateAlternates } from '@/lib/seo/hreflang'
import { breadcrumbList } from '@/lib/seo/schemas/breadcrumb-list'
import {
  VENDOR_ONBOARDING_HREF,
  VENDOR_PARTNER_PATH,
} from '@/lib/vendor/partner-page-content'

/**
 * /vendor-partner — public, crawlable Vendor partner landing page (issue 06).
 *
 * Sits BEFORE sign-in and funnels into the existing auth-gated Vendor
 * onboarding. Public + indexable (no noindex), with SEO metadata, hreflang
 * alternates, a visible breadcrumb, and a BreadcrumbList JSON-LD.
 *
 * Sections (structure in lib/vendor/partner-page-content.ts):
 *   hero → benefits → who can join → documents-by-KYC-tier (ADR-0007) →
 *   verification process → Booking & Payout flow → final CTA.
 *
 * The single primary CTA ("Start Vendor Onboarding") points at the real
 * auth-gated /vendor/onboarding route. Vocabulary is Vendor / Payout /
 * Experience / Booking throughout (CONTEXT.md — never "operator").
 *
 * Static SSR — no DB. Mirrors the about/safety/help marketing templates
 * (generateMetadata + generateAlternates, setRequestLocale, namespaced
 * getTranslations, JSON-LD breadcrumb, capped measure, DESIGN.md tokens,
 * .min-tap CTAs per ADR-0018).
 */

interface PageProps {
  params: Promise<{ locale: string }>
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { locale } = await params
  const t = await getTranslations({ locale, namespace: 'VendorPartnerPage' })
  return {
    title: t('metadata.title'),
    description: t('metadata.description'),
    alternates: generateAlternates(VENDOR_PARTNER_PATH, locale),
  }
}

const BENEFIT_ICONS = {
  onlineBookings: CalendarCheck,
  verifiedBadge: BadgeCheck,
  dashboard: LayoutDashboard,
  payoutTracking: Wallet,
  visibility: Search,
} as const

const WHO_ICONS = {
  rafting: Waves,
  trekking: Mountain,
  paragliding: Wind,
  diving: Anchor,
} as const

const TIER_ICONS = {
  phone: Phone,
  identity: IdCard,
  business: Building2,
} as const

export default async function VendorPartnerPage({
  params,
}: PageProps): Promise<ReactElement> {
  const { locale } = await params
  setRequestLocale(locale)

  const t = await getTranslations({ locale, namespace: 'VendorPartnerPage' })
  const tCommon = await getTranslations({ locale, namespace: 'Common' })

  const baseUrl = env.NEXT_PUBLIC_APP_URL.replace(/\/$/, '')
  const breadcrumbsJson = breadcrumbList([
    { name: tCommon('breadcrumb.home'), url: `${baseUrl}/` },
    { name: t('breadcrumb.label'), url: `${baseUrl}${VENDOR_PARTNER_PATH}` },
  ])

  const benefits = (
    ['onlineBookings', 'verifiedBadge', 'dashboard', 'payoutTracking', 'visibility'] as const
  ).map((id) => ({
    id,
    Icon: BENEFIT_ICONS[id],
    title: t(`benefits.${id}Title`),
    body: t(`benefits.${id}Body`),
  }))

  const whoCanJoin = (['rafting', 'trekking', 'paragliding', 'diving'] as const).map((id) => ({
    id,
    Icon: WHO_ICONS[id],
    title: t(`whoCanJoin.${id}Title`),
    body: t(`whoCanJoin.${id}Body`),
  }))

  const tiers = (
    [
      { id: 'phone', badge: null },
      { id: 'identity', badge: t('documents.identityBadge') },
      { id: 'business', badge: t('documents.businessBadge') },
    ] as const
  ).map((tier) => ({
    id: tier.id,
    Icon: TIER_ICONS[tier.id],
    badge: tier.badge,
    title: t(`documents.${tier.id}Title`),
    docs: t(`documents.${tier.id}Docs`),
    can: t(`documents.${tier.id}Can`),
    cannot: t(`documents.${tier.id}Cannot`),
  }))

  const verificationSteps = (['phone', 'identity', 'business'] as const).map((id) => ({
    id,
    label: t(`verification.${id}Step`),
  }))

  const bookingPayout = (['booking', 'partialPay', 'payout'] as const).map((id) => ({
    id,
    title: t(`bookingPayout.${id}Title`),
    body: t(`bookingPayout.${id}Body`),
  }))

  return (
    <main className="mx-auto max-w-3xl px-4 py-12 sm:px-6 sm:py-16">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbsJson) }}
      />

      <header className="mb-12">
        <nav aria-label="Breadcrumb" className="mb-4 text-sm text-muted-foreground">
          <Link href="/" className="transition-colors hover:text-primary-strong">
            {tCommon('breadcrumb.home')}
          </Link>{' '}
          <span aria-hidden>&#8250;</span>{' '}
          <span aria-current="page" className="text-foreground">
            {t('breadcrumb.label')}
          </span>
        </nav>
        <span className="inline-flex items-center gap-2 text-sm font-medium text-primary-strong">
          <Compass className="size-4" aria-hidden />
          {t('hero.eyebrow')}
        </span>
        <h1 className="mt-2 font-[family-name:var(--font-heading)] text-h1 font-semibold text-foreground">
          {t('hero.title')}
        </h1>
        <p className="mt-4 max-w-[var(--measure)] text-base text-muted-foreground">
          {t('hero.description')}
        </p>
        <div className="mt-7">
          <Link
            href={VENDOR_ONBOARDING_HREF}
            className="min-tap inline-flex h-12 items-center justify-center gap-2 rounded-[var(--radius-control)] bg-primary px-6 text-sm font-semibold text-primary-foreground shadow-[var(--shadow-md)] transition-colors duration-150 hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            {t('hero.cta')}
          </Link>
        </div>
      </header>

      {/* Benefits */}
      <section aria-label={t('benefits.heading')} className="mb-12">
        <h2 className="mb-5 font-[family-name:var(--font-heading)] text-h3 font-semibold text-foreground">
          {t('benefits.heading')}
        </h2>
        <ul className="grid gap-4 sm:grid-cols-2">
          {benefits.map(({ id, Icon, title, body }) => (
            <li
              key={id}
              className="rounded-[var(--radius-card)] border border-border bg-surface-1 p-5 shadow-[var(--shadow-sm)]"
            >
              <h3 className="flex items-center gap-2 text-base font-medium text-foreground">
                <Icon className="size-5 text-primary-strong" aria-hidden />
                {title}
              </h3>
              <p className="mt-2 text-sm text-muted-foreground">{body}</p>
            </li>
          ))}
        </ul>
      </section>

      {/* Who can join */}
      <section aria-label={t('whoCanJoin.heading')} className="mb-12">
        <h2 className="mb-3 font-[family-name:var(--font-heading)] text-h3 font-semibold text-foreground">
          {t('whoCanJoin.heading')}
        </h2>
        <p className="mb-5 max-w-[var(--measure)] text-base text-muted-foreground">
          {t('whoCanJoin.intro')}
        </p>
        <ul className="grid gap-4 sm:grid-cols-2">
          {whoCanJoin.map(({ id, Icon, title, body }) => (
            <li
              key={id}
              className="rounded-[var(--radius-card)] border border-border bg-surface-1 p-5 shadow-[var(--shadow-sm)]"
            >
              <h3 className="flex items-center gap-2 text-base font-medium text-foreground">
                <Icon className="size-5 text-primary-strong" aria-hidden />
                {title}
              </h3>
              <p className="mt-2 text-sm text-muted-foreground">{body}</p>
            </li>
          ))}
        </ul>
      </section>

      {/* Documents required, mapped to ADR-0007 KYC tiers */}
      <section aria-label={t('documents.heading')} className="mb-12">
        <h2 className="mb-3 font-[family-name:var(--font-heading)] text-h3 font-semibold text-foreground">
          {t('documents.heading')}
        </h2>
        <p className="mb-5 max-w-[var(--measure)] text-base text-muted-foreground">
          {t('documents.intro')}
        </p>
        <ol className="space-y-4">
          {tiers.map(({ id, Icon, badge, title, docs, can, cannot }) => (
            <li
              key={id}
              className="rounded-[var(--radius-card)] border border-border bg-surface-1 p-5 shadow-[var(--shadow-sm)]"
            >
              <h3 className="flex flex-wrap items-center gap-2 text-base font-medium text-foreground">
                <Icon className="size-5 text-primary-strong" aria-hidden />
                {title}
                {badge ? (
                  <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2.5 py-0.5 text-xs font-medium text-primary-strong">
                    <BadgeCheck className="size-3.5" aria-hidden />
                    {badge}
                  </span>
                ) : null}
              </h3>
              <dl className="mt-3 space-y-2 text-sm">
                <div>
                  <dt className="font-medium text-foreground">{tCommon('actions.submit')}</dt>
                  <dd className="text-muted-foreground">{docs}</dd>
                </div>
                <p className="text-muted-foreground">{can}</p>
                <p className="text-muted-foreground">{cannot}</p>
              </dl>
            </li>
          ))}
        </ol>
      </section>

      {/* Verification process */}
      <section aria-label={t('verification.heading')} className="mb-12">
        <h2 className="mb-3 font-[family-name:var(--font-heading)] text-h3 font-semibold text-foreground">
          {t('verification.heading')}
        </h2>
        <p className="mb-5 max-w-[var(--measure)] text-base text-muted-foreground">
          {t('verification.intro')}
        </p>
        <ol className="space-y-3">
          {verificationSteps.map(({ id, label }, index) => (
            <li key={id} className="flex gap-3">
              <span
                aria-hidden
                className="flex size-7 shrink-0 items-center justify-center rounded-full bg-primary text-sm font-semibold text-primary-foreground"
              >
                {index + 1}
              </span>
              <p className="max-w-[var(--measure)] text-sm text-muted-foreground">{label}</p>
            </li>
          ))}
        </ol>
      </section>

      {/* Booking & Payout flow */}
      <section aria-label={t('bookingPayout.heading')} className="mb-12">
        <h2 className="mb-5 font-[family-name:var(--font-heading)] text-h3 font-semibold text-foreground">
          {t('bookingPayout.heading')}
        </h2>
        <dl className="space-y-6">
          {bookingPayout.map(({ id, title, body }) => (
            <div key={id}>
              <dt className="text-base font-medium text-foreground">{title}</dt>
              <dd className="mt-2 max-w-[var(--measure)] text-sm text-muted-foreground">
                {body}
              </dd>
            </div>
          ))}
        </dl>
      </section>

      {/* Final CTA → real auth-gated onboarding */}
      <section
        aria-label={t('finalCta.heading')}
        className="rounded-[var(--radius-card)] border border-border bg-surface-1 p-6 text-center shadow-[var(--shadow-sm)]"
      >
        <h2 className="font-[family-name:var(--font-heading)] text-h3 font-semibold text-foreground">
          {t('finalCta.heading')}
        </h2>
        <p className="mx-auto mt-2 max-w-[var(--measure)] text-sm text-muted-foreground">
          {t('finalCta.body')}
        </p>
        <Link
          href={VENDOR_ONBOARDING_HREF}
          className="min-tap mt-5 inline-flex h-12 items-center justify-center gap-2 rounded-[var(--radius-control)] bg-primary px-6 text-sm font-semibold text-primary-foreground shadow-[var(--shadow-md)] transition-colors duration-150 hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          {t('finalCta.cta')}
        </Link>
      </section>
    </main>
  )
}
