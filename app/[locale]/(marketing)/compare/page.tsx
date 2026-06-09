import type { ReactElement } from 'react'

import { getTranslations, setRequestLocale } from 'next-intl/server'

import { loadComparisonDatasetAction } from '@/components/compare/actions'
import { CompareView } from '@/components/compare/view'

interface PageProps {
  params: Promise<{ locale: string }>
}

/**
 * Dedicated comparison page (`/compare`, DECISION D10).
 *
 * Renders the side-by-side comparison of the visitor's compare-selected
 * Experiences (2-3, from localStorage). The selection is client-only, so the
 * page is a thin server shell around the `CompareView` client component, which
 * reads the slugs and resolves them via the `loadComparisonDatasetAction`
 * server action (gated through `lib/experiences/public-filter` — no fixture /
 * unpublished leak, guardrail D0).
 *
 * NOINDEX (see `generateMetadata`): this is a transient, per-visitor view of an
 * arbitrary selection — never indexable, and absent from the sitemap
 * (`STATIC_PUBLIC_PATHS` does not list it).
 */
export default async function ComparePage({ params }: PageProps): Promise<ReactElement> {
  const { locale } = await params
  setRequestLocale(locale)
  const t = await getTranslations({ locale, namespace: 'Compare' })

  return (
    <main className="mx-auto max-w-6xl px-4 py-[var(--space-section)] sm:px-6">
      <header className="mb-8">
        <h1 className="font-heading text-h2 font-bold tracking-tight">{t('page.heading')}</h1>
        <p className="mt-2 text-sm text-muted-foreground">{t('page.subheading')}</p>
      </header>
      <CompareView fetchDataset={loadComparisonDatasetAction} />
    </main>
  )
}

export async function generateMetadata({ params }: PageProps) {
  const { locale } = await params
  const t = await getTranslations({ locale, namespace: 'Compare' })

  // D10 — /compare is NOINDEX (transient per-visitor selection view). Emitted via
  // the Metadata API so the directive lands in <head>. `follow: true` lets
  // crawlers still traverse the experience / vendor links off the page.
  return {
    title: t('metadata.title'),
    description: t('metadata.description'),
    robots: { index: false, follow: true },
  }
}
