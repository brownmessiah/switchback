import type { Metadata } from 'next'
import Link from 'next/link'
import type { ReactElement } from 'react'
import { ArrowRight } from 'lucide-react'
import { getTranslations, setRequestLocale } from 'next-intl/server'

import { CANCELLATION_POLICY_PATH, LEGAL_REVIEW_NOTICE_KEY } from '@/lib/legal/content'
import { env } from '@/lib/env'
import { generateAlternates } from '@/lib/seo/hreflang'
import { breadcrumbList } from '@/lib/seo/schemas/breadcrumb-list'

/**
 * /refund-cancellation — Refund & Cancellation Policy (issue 07).
 *
 * Business-safe DRAFT summarising how cancellations and refunds actually work:
 * the three ADR-0005 presets (Flexible / Moderate / Strict, never "free"), the
 * ADR-0004 refund SLA (Refund balance credited 24–48h, optional bank cashout
 * 5–7 working days — kept distinct, never over-promised), and Vendor-cancelled
 * Bookings always refunded in full. Carries a visible "pending final legal
 * review" note (DECISION D7); copy is pinned under RefundCancellationPage.
 *
 * This summary links to the canonical /cancellation-policy page, which holds
 * the full reference doc and the interactive Refund Calculator.
 *
 * Public + crawlable (it does NOT opt out of indexing): marketing SSR template
 * — setRequestLocale,
 * namespaced getTranslations, generateMetadata + hreflang alternates, a visible
 * breadcrumb, and a BreadcrumbList JSON-LD.
 */

const PAGE_PATH = '/refund-cancellation'

interface PageProps {
  params: Promise<{ locale: string }>
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { locale } = await params
  const t = await getTranslations({ locale, namespace: 'RefundCancellationPage' })
  return {
    title: t('metadata.title'),
    description: t('metadata.description'),
    alternates: generateAlternates(PAGE_PATH, locale),
  }
}

/** ADR-0005 presets, in display order. */
const PRESET_KEYS = ['flexible', 'moderate', 'strict'] as const

const NARRATIVE_SECTIONS = [
  'insidePolicy',
  'vendorCancelled',
  'outsidePolicy',
  'refundSla',
] as const

export default async function RefundCancellationPage({
  params,
}: PageProps): Promise<ReactElement> {
  const { locale } = await params
  setRequestLocale(locale)

  const t = await getTranslations({ locale, namespace: 'RefundCancellationPage' })
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

      {/* The three ADR-0005 presets. */}
      <section aria-label={t('presets.heading')} className="mb-12">
        <h2 className="mb-3 font-[family-name:var(--font-heading)] text-h3 font-semibold text-foreground">
          {t('presets.heading')}
        </h2>
        <p className="mb-5 max-w-[var(--measure)] text-base text-muted-foreground">
          {t('presets.intro')}
        </p>
        <div className="overflow-x-auto rounded-[var(--radius-card)] border border-border">
          <table className="w-full border-collapse text-left text-sm">
            <thead>
              <tr className="border-b border-border bg-surface-2">
                <th className="px-4 py-3 font-semibold text-foreground">
                  {t('presets.columnPreset')}
                </th>
                <th className="px-4 py-3 font-semibold text-foreground">
                  {t('presets.columnFull')}
                </th>
                <th className="px-4 py-3 font-semibold text-foreground">
                  {t('presets.columnHalf')}
                </th>
                <th className="px-4 py-3 font-semibold text-foreground">
                  {t('presets.columnAfter')}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {PRESET_KEYS.map((key) => (
                <tr key={key} className="hover:bg-muted/40">
                  <td className="px-4 py-3 font-medium text-foreground">{t(`presets.${key}`)}</td>
                  <td className="px-4 py-3 text-muted-foreground">{t(`presets.${key}Full`)}</td>
                  <td className="px-4 py-3 text-muted-foreground">{t(`presets.${key}Half`)}</td>
                  <td className="px-4 py-3 text-muted-foreground">{t('presets.noRefund')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <div className="space-y-10">
        {NARRATIVE_SECTIONS.map((id) => (
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

      {/* Link to the canonical /cancellation-policy page (full reference +
          interactive Refund Calculator). */}
      <section
        aria-label={t('policyLink.label')}
        className="mt-12 rounded-[var(--radius-card)] border border-border bg-surface-1 p-6 shadow-[var(--shadow-sm)]"
      >
        <p className="max-w-[var(--measure)] text-sm text-muted-foreground">
          {t('policyLink.body')}
        </p>
        <Link
          href={CANCELLATION_POLICY_PATH}
          className="min-tap mt-4 inline-flex h-11 items-center gap-2 text-sm font-semibold text-primary-strong underline underline-offset-4 transition-colors hover:text-primary focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          {t('policyLink.label')}
          <ArrowRight className="size-4" aria-hidden />
        </Link>
      </section>

      <section aria-label={t('contact.heading')} className="mt-12">
        <h2 className="mb-3 font-[family-name:var(--font-heading)] text-h3 font-semibold text-foreground">
          {t('contact.heading')}
        </h2>
        <p className="max-w-[var(--measure)] text-base text-muted-foreground">
          {t('contact.body')}
        </p>
      </section>
    </main>
  )
}
