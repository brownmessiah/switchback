import type { Metadata } from 'next'
import Link from 'next/link'
import type { ReactElement } from 'react'
import { getTranslations, setRequestLocale } from 'next-intl/server'

import { LEGAL_REVIEW_NOTICE_KEY } from '@/lib/legal/content'
import { env } from '@/lib/env'
import { generateAlternates } from '@/lib/seo/hreflang'
import { breadcrumbList } from '@/lib/seo/schemas/breadcrumb-list'

/**
 * /terms — Terms of Service (issue 07).
 *
 * A business-safe DRAFT reflecting the real Switchback model: a marketplace /
 * intermediary connecting Customers with independent third-party Vendors who
 * run the Experiences (CONTEXT.md — never "operator"). Carries a visible
 * "pending final legal review" note (DECISION D7); copy is pinned in
 * lib/i18n/messages/en.json under the TermsPage namespace and the load-bearing
 * facts in lib/legal/content.ts.
 *
 * Public + crawlable (it does NOT opt out of indexing): the marketing SSR
 * template — setRequestLocale,
 * namespaced getTranslations, generateMetadata + hreflang alternates, a visible
 * breadcrumb, and a BreadcrumbList JSON-LD.
 */

const PAGE_PATH = '/terms'

interface PageProps {
  params: Promise<{ locale: string }>
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { locale } = await params
  const t = await getTranslations({ locale, namespace: 'TermsPage' })
  return {
    title: t('metadata.title'),
    description: t('metadata.description'),
    alternates: generateAlternates(PAGE_PATH, locale),
  }
}

const SECTIONS = [
  'marketplace',
  'accounts',
  'bookings',
  'cancellations',
  'permits',
  'conduct',
  'liability',
  'changes',
  'contact',
] as const

export default async function TermsPage({ params }: PageProps): Promise<ReactElement> {
  const { locale } = await params
  setRequestLocale(locale)

  const t = await getTranslations({ locale, namespace: 'TermsPage' })
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
        <p className="mt-2 text-sm text-muted-foreground">{t('hero.updated')}</p>
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
        {SECTIONS.map((id) => (
          <section key={id} aria-label={t(`${id}.heading`)}>
            <h2 className="mb-3 font-[family-name:var(--font-heading)] text-h3 font-semibold text-foreground">
              {t(`${id}.heading`)}
            </h2>
            <p className="max-w-[var(--measure)] text-base text-muted-foreground">
              {t(`${id}.body`)}
            </p>
            {id === 'marketplace' ? (
              <p className="mt-3 max-w-[var(--measure)] text-base text-muted-foreground">
                {t('marketplace.vendorResponsibility')}
              </p>
            ) : null}
          </section>
        ))}
      </div>
    </main>
  )
}
