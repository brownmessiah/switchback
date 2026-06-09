import type { Metadata } from 'next'
import Link from 'next/link'
import type { ReactElement } from 'react'
import { getTranslations, setRequestLocale } from 'next-intl/server'

import { LEGAL_REVIEW_NOTICE_KEY } from '@/lib/legal/content'
import { env } from '@/lib/env'
import { generateAlternates } from '@/lib/seo/hreflang'
import { breadcrumbList } from '@/lib/seo/schemas/breadcrumb-list'

/**
 * /vendor-terms — Vendor Terms (issue 07).
 *
 * Business-safe DRAFT for independent third-party Vendors: the ADR-0007 KYC
 * tiers (Phone / Identity / Business verified), Commission, the ADR-0016 Payout
 * flow (net of Commission + GST + TDS, issued T+7 from Completion; never
 * "settlement"/"disbursement"), TDS 0.1% under Section 194-O, and cancellation
 * obligations. Carries a visible "pending final legal review" note (DECISION
 * D7); copy is pinned under VendorTermsPage.
 *
 * Public + crawlable (it does NOT opt out of indexing): marketing SSR template
 * — setRequestLocale,
 * namespaced getTranslations, generateMetadata + hreflang alternates, a visible
 * breadcrumb, and a BreadcrumbList JSON-LD.
 */

const PAGE_PATH = '/vendor-terms'

interface PageProps {
  params: Promise<{ locale: string }>
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { locale } = await params
  const t = await getTranslations({ locale, namespace: 'VendorTermsPage' })
  return {
    title: t('metadata.title'),
    description: t('metadata.description'),
    alternates: generateAlternates(PAGE_PATH, locale),
  }
}

/** Sections rendered as heading + body prose. */
const PROSE_SECTIONS = ['relationship', 'commission', 'payout', 'tax', 'cancellation', 'contact'] as const

/** The three ADR-0007 KYC tiers, rendered as a list. */
const KYC_TIERS = ['phone', 'identity', 'business'] as const

export default async function VendorTermsPage({ params }: PageProps): Promise<ReactElement> {
  const { locale } = await params
  setRequestLocale(locale)

  const t = await getTranslations({ locale, namespace: 'VendorTermsPage' })
  const tCommon = await getTranslations({ locale, namespace: 'Common' })

  const baseUrl = env.NEXT_PUBLIC_APP_URL.replace(/\/$/, '')
  const breadcrumbsJson = breadcrumbList([
    { name: tCommon('breadcrumb.home'), url: `${baseUrl}/` },
    { name: t('breadcrumb.label'), url: `${baseUrl}${PAGE_PATH}` },
  ])

  return (
    <main className="mx-auto max-w-3xl px-4 py-12 sm:px-6 sm:py-16">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbsJson) }}
      />

      <header className="mb-8">
        <nav aria-label="Breadcrumb" className="mb-4 text-sm text-muted-foreground">
          <Link href="/" className="transition-colors hover:text-primary-strong">
            {tCommon('breadcrumb.home')}
          </Link>{' '}
          <span aria-hidden>&#8250;</span>{' '}
          <span aria-current="page" className="text-foreground">
            {t('breadcrumb.label')}
          </span>
        </nav>
        <h1 className="font-[family-name:var(--font-heading)] text-h1 font-semibold text-foreground">
          {t('hero.title')}
        </h1>
        <p className="mt-4 max-w-[var(--measure)] text-base text-muted-foreground">
          {t('hero.intro')}
        </p>
      </header>

      {/* Visible "pending final legal review" notice (DECISION D7). */}
      <p
        role="note"
        className="mb-10 rounded-[var(--radius-card)] border border-warning/30 bg-warning/10 px-4 py-3 text-sm text-foreground"
      >
        {t('reviewNotice' satisfies typeof LEGAL_REVIEW_NOTICE_KEY)}
      </p>

      <div className="space-y-10">
        {/* Relationship leads. */}
        <section aria-label={t('relationship.heading')}>
          <h2 className="mb-3 font-[family-name:var(--font-heading)] text-h3 font-semibold text-foreground">
            {t('relationship.heading')}
          </h2>
          <p className="max-w-[var(--measure)] text-base text-muted-foreground">
            {t('relationship.body')}
          </p>
        </section>

        {/* KYC tiers (ADR-0007) — rendered as an ordered list. */}
        <section aria-label={t('kyc.heading')}>
          <h2 className="mb-3 font-[family-name:var(--font-heading)] text-h3 font-semibold text-foreground">
            {t('kyc.heading')}
          </h2>
          <p className="mb-5 max-w-[var(--measure)] text-base text-muted-foreground">
            {t('kyc.intro')}
          </p>
          <ol className="space-y-3">
            {KYC_TIERS.map((tier, index) => (
              <li key={tier} className="flex gap-3">
                <span
                  aria-hidden
                  className="flex size-7 shrink-0 items-center justify-center rounded-full bg-primary text-sm font-semibold text-primary-foreground"
                >
                  {index + 1}
                </span>
                <p className="max-w-[var(--measure)] text-sm text-muted-foreground">
                  {t(`kyc.${tier}`)}
                </p>
              </li>
            ))}
          </ol>
        </section>

        {/* Remaining prose sections (Commission, Payouts, TDS/GST, cancellation, contact). */}
        {PROSE_SECTIONS.filter((id) => id !== 'relationship').map((id) => (
          <section key={id} aria-label={t(`${id}.heading`)}>
            <h2 className="mb-3 font-[family-name:var(--font-heading)] text-h3 font-semibold text-foreground">
              {t(`${id}.heading`)}
            </h2>
            <p className="max-w-[var(--measure)] text-base text-muted-foreground">
              {t(`${id}.body`)}
            </p>
          </section>
        ))}
      </div>
    </main>
  )
}
