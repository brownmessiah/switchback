import type { Metadata } from 'next'
import Link from 'next/link'
import type { ReactElement } from 'react'
import { CheckCircle2, Clock, CircleSlash } from 'lucide-react'
import { getTranslations, setRequestLocale } from 'next-intl/server'

import { generateAlternates } from '@/lib/seo/hreflang'

import { RefundCalculatorIsland } from './refund-calculator-island'

/**
 * Cancellation policy SEO + trust content per ADR-0005.
 *
 * Two reasons this page is load-bearing, not decorative:
 *   1. Indian-incumbent research identified policy *transparency*, not
 *      generosity, as the wedge. Thrillophilia's customer complaints are
 *      about ambiguity. Indiahikes turned their policy into a blog post
 *      that ranks. A clear, linkable policy page is the trust artefact.
 *   2. ADR-0005 says "link to it from every Experience card"; the link
 *      is present in the site header + footer and every booking
 *      confirmation. This page is the canonical destination.
 *
 * Direction B ("The Refund Calculator", #68): an interactive pre-login refund
 * quote — the single highest-differentiation element — is the hero, sitting
 * ABOVE the reference policy doc. The calculator computes the EXACT figure via
 * the same pure `quoteRefund` the money path uses (no reimplementation). The
 * reference doc below is redesigned onto the DESIGN.md token system (status
 * colours per slab, capped measure, display heading face). Refund prose is
 * still a Server Component; only the calculator is a client island.
 */

interface PageProps {
  params: Promise<{ locale: string }>
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { locale } = await params
  const t = await getTranslations({ locale, namespace: 'CancellationPolicyPage' })
  return {
    title: t('metadata.title'),
    description: t('metadata.description'),
    alternates: generateAlternates('/cancellation-policy', locale),
  }
}

/** Pre-resolved preset data — no dynamic translation keys. */
interface PresetRow {
  key: 'flexible' | 'moderate' | 'strict'
}

const PRESET_KEYS: PresetRow[] = [
  { key: 'flexible' },
  { key: 'moderate' },
  { key: 'strict' },
]

export default async function CancellationPolicyPage({ params }: PageProps): Promise<ReactElement> {
  const { locale } = await params
  setRequestLocale(locale)

  const t = await getTranslations({ locale, namespace: 'CancellationPolicyPage' })
  const tCommon = await getTranslations({ locale, namespace: 'Common' })

  const emailAddress = t('questions.emailAddress')

  return (
    <main className="mx-auto max-w-3xl px-4 py-12 sm:px-6 sm:py-16">
      <header className="mb-10">
        <nav aria-label="Breadcrumb" className="mb-4 text-sm text-muted-foreground">
          <Link href="/" className="transition-colors hover:text-primary-strong">
            {tCommon('breadcrumb.home')}
          </Link>{' '}
          <span aria-hidden>&#8250;</span>{' '}
          <span aria-current="page" className="text-foreground">
            {t('breadcrumb.refundPolicy')}
          </span>
        </nav>
        <h1 className="font-[family-name:var(--font-heading)] text-h1 font-semibold text-foreground">
          {t('hero.title')}
        </h1>
        <p className="mt-4 max-w-[var(--measure)] text-base text-muted-foreground">
          {t('hero.description')}
        </p>
      </header>

      {/* Direction B hero — interactive Refund Calculator, ABOVE the doc. */}
      <RefundCalculatorIsland />

      <section aria-label={t('presets.heading')} className="mb-12">
        <h2 className="mb-4 font-[family-name:var(--font-heading)] text-h3 font-semibold text-foreground">
          {t('presets.heading')}
        </h2>
        <div className="overflow-x-auto rounded-[var(--radius-card)] border border-border">
          <table className="w-full border-collapse text-left text-sm">
            <thead>
              <tr className="border-b border-border bg-surface-2">
                <th className="px-4 py-3 font-semibold text-foreground">
                  {t('presets.columnPreset')}
                </th>
                <th className="px-4 py-3 font-semibold text-foreground">
                  <span className="inline-flex items-center gap-1.5">
                    <CheckCircle2 className="size-4 text-success" aria-hidden />
                    {t('presets.columnFullRefund')}
                  </span>
                </th>
                <th className="px-4 py-3 font-semibold text-foreground">
                  <span className="inline-flex items-center gap-1.5">
                    {/* D-contrast: darker amber (L 0.50 vs the global --warning
                        0.535) so this small-text amber clears WCAG AA with
                        headroom on both white and the muted hover row. Same
                        hue/chroma as the token — just a notch darker. */}
                    <Clock className="size-4 text-[oklch(0.5_0.15_75)]" aria-hidden />
                    {t('presets.columnHalfRefund')}
                  </span>
                </th>
                <th className="px-4 py-3 font-semibold text-foreground">
                  <span className="inline-flex items-center gap-1.5">
                    <CircleSlash className="size-4 text-destructive" aria-hidden />
                    {t('presets.columnAfter')}
                  </span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {PRESET_KEYS.map((row) => (
                <tr key={row.key} className="hover:bg-muted/40">
                  <td className="px-4 py-3 font-medium text-foreground">
                    {t(`presets.${row.key}`)}
                  </td>
                  <td className="px-4 py-3 text-success">
                    {t(`presets.${row.key}Full`)}
                  </td>
                  <td className="px-4 py-3 font-medium text-[oklch(0.5_0.15_75)]">
                    {t(`presets.${row.key}Half`)}
                  </td>
                  <td className="px-4 py-3 text-destructive">{t('presets.noRefund')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section aria-label={t('examples.heading')} className="mb-12">
        <h2 className="mb-4 font-[family-name:var(--font-heading)] text-h3 font-semibold text-foreground">
          {t('examples.heading')}
        </h2>
        <ul className="space-y-5">
          {PRESET_KEYS.map((row) => (
            <li
              key={row.key}
              className="rounded-[var(--radius-card)] border border-border bg-surface-1 p-5 shadow-[var(--shadow-sm)]"
            >
              <h3 className="text-base font-medium text-foreground">
                {t(`presets.${row.key}`)} — {t(`examples.${row.key}Title`)}
              </h3>
              <p className="mt-2 max-w-[var(--measure)] text-sm text-muted-foreground">
                {t(`examples.${row.key}Body`)}
              </p>
            </li>
          ))}
        </ul>
      </section>

      <section aria-label={t('specialCases.heading')} className="mb-12">
        <h2 className="mb-4 font-[family-name:var(--font-heading)] text-h3 font-semibold text-foreground">
          {t('specialCases.heading')}
        </h2>
        <dl className="space-y-5">
          <div>
            <dt className="font-medium text-foreground">
              {t('specialCases.vendorCancelledTitle')}
            </dt>
            <dd className="mt-1 max-w-[var(--measure)] text-sm text-muted-foreground">
              {t('specialCases.vendorCancelledBody')}
            </dd>
          </div>
          <div>
            <dt className="font-medium text-foreground">
              {t('specialCases.outsideWindowTitle')}
            </dt>
            <dd className="mt-1 max-w-[var(--measure)] text-sm text-muted-foreground">
              {t('specialCases.outsideWindowBody')}
            </dd>
          </div>
          <div>
            <dt className="font-medium text-foreground">
              {t('specialCases.customPoliciesTitle')}
            </dt>
            <dd className="mt-1 max-w-[var(--measure)] text-sm text-muted-foreground">
              {t('specialCases.customPoliciesBody')}
            </dd>
          </div>
        </dl>
      </section>

      <section aria-label={t('refundSla.heading')} className="mb-12">
        <h2 className="mb-4 font-[family-name:var(--font-heading)] text-h3 font-semibold text-foreground">
          {t('refundSla.heading')}
        </h2>
        <p className="max-w-[var(--measure)] text-base text-foreground">
          {t('refundSla.body')}
        </p>
      </section>

      <section aria-label={t('questions.heading')}>
        <h2 className="mb-4 font-[family-name:var(--font-heading)] text-h3 font-semibold text-foreground">
          {t('questions.heading')}
        </h2>
        <p className="max-w-[var(--measure)] text-base text-foreground">
          {t('questions.body', {
            email: emailAddress,
          }).split(emailAddress).map((part, i, arr) =>
            i < arr.length - 1 ? (
              <span key={i}>
                {part}
                <a
                  href={`mailto:${emailAddress}`}
                  className="font-medium text-primary-strong underline underline-offset-2"
                >
                  {emailAddress}
                </a>
              </span>
            ) : (
              <span key={i}>{part}</span>
            ),
          )}
        </p>
      </section>
    </main>
  )
}
