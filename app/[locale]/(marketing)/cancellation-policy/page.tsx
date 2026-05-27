import type { Metadata } from 'next'
import Link from 'next/link'
import type { ReactElement } from 'react'
import { getTranslations, setRequestLocale } from 'next-intl/server'

import { env } from '@/lib/env'

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
 * Content is fully static — no DB query. Server Component, ISR n/a.
 */

interface PageProps {
  params: Promise<{ locale: string }>
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { locale } = await params
  const t = await getTranslations({ locale, namespace: 'CancellationPolicyPage' })
  const baseUrl = env.NEXT_PUBLIC_APP_URL.replace(/\/$/, '')
  return {
    title: t('metadata.title'),
    description: t('metadata.description'),
    alternates: {
      canonical: `${baseUrl}/cancellation-policy`,
    },
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
        <nav aria-label="Breadcrumb" className="mb-4 text-sm text-zinc-500">
          <Link href="/" className="hover:text-zinc-700 dark:hover:text-zinc-300">
            {tCommon('breadcrumb.home')}
          </Link>{' '}
          <span aria-hidden>&#8250;</span>{' '}
          <span aria-current="page" className="text-zinc-700 dark:text-zinc-300">
            {t('breadcrumb.refundPolicy')}
          </span>
        </nav>
        <h1 className="text-3xl font-semibold leading-tight tracking-tight text-zinc-900 sm:text-4xl dark:text-zinc-50">
          {t('hero.title')}
        </h1>
        <p className="mt-4 text-base text-zinc-600 dark:text-zinc-400">
          {t('hero.description')}
        </p>
      </header>

      <section aria-label={t('presets.heading')} className="mb-12">
        <h2 className="mb-4 text-xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
          {t('presets.heading')}
        </h2>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left text-sm">
            <thead>
              <tr className="border-b border-zinc-300 dark:border-zinc-700">
                <th className="py-3 pr-4 font-semibold text-zinc-700 dark:text-zinc-300">
                  {t('presets.columnPreset')}
                </th>
                <th className="py-3 pr-4 font-semibold text-zinc-700 dark:text-zinc-300">
                  {t('presets.columnFullRefund')}
                </th>
                <th className="py-3 pr-4 font-semibold text-zinc-700 dark:text-zinc-300">
                  {t('presets.columnHalfRefund')}
                </th>
                <th className="py-3 font-semibold text-zinc-700 dark:text-zinc-300">
                  {t('presets.columnAfter')}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
              {PRESET_KEYS.map((row) => (
                <tr key={row.key}>
                  <td className="py-3 pr-4 font-medium text-zinc-900 dark:text-zinc-50">
                    {t(`presets.${row.key}`)}
                  </td>
                  <td className="py-3 pr-4 text-zinc-700 dark:text-zinc-300">
                    {t(`presets.${row.key}Full`)}
                  </td>
                  <td className="py-3 pr-4 text-zinc-700 dark:text-zinc-300">
                    {t(`presets.${row.key}Half`)}
                  </td>
                  <td className="py-3 text-zinc-700 dark:text-zinc-300">{t('presets.noRefund')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section aria-label={t('examples.heading')} className="mb-12">
        <h2 className="mb-4 text-xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
          {t('examples.heading')}
        </h2>
        <ul className="space-y-5">
          {PRESET_KEYS.map((row) => (
            <li
              key={row.key}
              className="rounded-lg border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-950"
            >
              <h3 className="text-base font-medium text-zinc-900 dark:text-zinc-50">
                {t(`presets.${row.key}`)} — {t(`examples.${row.key}Title`)}
              </h3>
              <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
                {t(`examples.${row.key}Body`)}
              </p>
            </li>
          ))}
        </ul>
      </section>

      <section aria-label={t('specialCases.heading')} className="mb-12">
        <h2 className="mb-4 text-xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
          {t('specialCases.heading')}
        </h2>
        <dl className="space-y-5">
          <div>
            <dt className="font-medium text-zinc-900 dark:text-zinc-50">
              {t('specialCases.vendorCancelledTitle')}
            </dt>
            <dd className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
              {t('specialCases.vendorCancelledBody')}
            </dd>
          </div>
          <div>
            <dt className="font-medium text-zinc-900 dark:text-zinc-50">
              {t('specialCases.outsideWindowTitle')}
            </dt>
            <dd className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
              {t('specialCases.outsideWindowBody')}
            </dd>
          </div>
          <div>
            <dt className="font-medium text-zinc-900 dark:text-zinc-50">
              {t('specialCases.customPoliciesTitle')}
            </dt>
            <dd className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
              {t('specialCases.customPoliciesBody')}
            </dd>
          </div>
        </dl>
      </section>

      <section aria-label={t('refundSla.heading')} className="mb-12">
        <h2 className="mb-4 text-xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
          {t('refundSla.heading')}
        </h2>
        <p className="text-base text-zinc-700 dark:text-zinc-300">
          {t('refundSla.body')}
        </p>
      </section>

      <section aria-label={t('questions.heading')}>
        <h2 className="mb-4 text-xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
          {t('questions.heading')}
        </h2>
        <p className="text-base text-zinc-700 dark:text-zinc-300">
          {t('questions.body', {
            email: emailAddress,
          }).split(emailAddress).map((part, i, arr) =>
            i < arr.length - 1 ? (
              <span key={i}>
                {part}
                <a
                  href={`mailto:${emailAddress}`}
                  className="font-medium text-zinc-900 underline underline-offset-2 dark:text-zinc-50"
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
