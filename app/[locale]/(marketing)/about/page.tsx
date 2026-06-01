import type { Metadata } from 'next'
import Link from 'next/link'
import type { ReactElement } from 'react'
import { Compass, Search, CreditCard, ShieldCheck } from 'lucide-react'
import { getTranslations, setRequestLocale } from 'next-intl/server'

import { generateAlternates } from '@/lib/seo/hreflang'

/**
 * About page (issue 06).
 *
 * Honest company/mission page: Outvers is an India adventure-activity
 * marketplace connecting customers with KYC-verified independent vendors.
 * Uses CONTEXT.md vocabulary (Experience, Vendor, KYC tier, partial pay,
 * Advance, safety stack) and is explicit about what Outvers is NOT (it does
 * not run trips, does not broker permits, SOS is a notification tool — per
 * ADR-0015). Static SSR, no DB. Mirrors the cancellation-policy template.
 */

interface PageProps {
  params: Promise<{ locale: string }>
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { locale } = await params
  const t = await getTranslations({ locale, namespace: 'AboutPage' })
  return {
    title: t('metadata.title'),
    description: t('metadata.description'),
    alternates: generateAlternates('/about', locale),
  }
}

export default async function AboutPage({ params }: PageProps): Promise<ReactElement> {
  const { locale } = await params
  setRequestLocale(locale)

  const t = await getTranslations({ locale, namespace: 'AboutPage' })
  const tCommon = await getTranslations({ locale, namespace: 'Common' })

  const steps = [
    { Icon: Search, title: t('howItWorks.browseTitle'), body: t('howItWorks.browseBody') },
    { Icon: CreditCard, title: t('howItWorks.bookTitle'), body: t('howItWorks.bookBody') },
    { Icon: ShieldCheck, title: t('howItWorks.trustTitle'), body: t('howItWorks.trustBody') },
  ]

  return (
    <main className="mx-auto max-w-3xl px-4 py-12 sm:px-6 sm:py-16">
      <header className="mb-10">
        <nav aria-label="Breadcrumb" className="mb-4 text-sm text-muted-foreground">
          <Link href="/" className="transition-colors hover:text-primary-strong">
            {tCommon('breadcrumb.home')}
          </Link>{' '}
          <span aria-hidden>&#8250;</span>{' '}
          <span aria-current="page" className="text-foreground">
            {t('breadcrumb.about')}
          </span>
        </nav>
        <span className="inline-flex items-center gap-2 text-sm font-medium text-primary-strong">
          <Compass className="size-4" aria-hidden />
          {t('breadcrumb.about')}
        </span>
        <h1 className="mt-2 font-[family-name:var(--font-heading)] text-h1 font-semibold text-foreground">
          {t('hero.title')}
        </h1>
        <p className="mt-4 max-w-[var(--measure)] text-base text-muted-foreground">
          {t('hero.description')}
        </p>
      </header>

      <section aria-label={t('mission.heading')} className="mb-12">
        <h2 className="mb-3 font-[family-name:var(--font-heading)] text-h3 font-semibold text-foreground">
          {t('mission.heading')}
        </h2>
        <p className="max-w-[var(--measure)] text-base text-muted-foreground">
          {t('mission.body')}
        </p>
      </section>

      <section aria-label={t('howItWorks.heading')} className="mb-12">
        <h2 className="mb-5 font-[family-name:var(--font-heading)] text-h3 font-semibold text-foreground">
          {t('howItWorks.heading')}
        </h2>
        <ol className="space-y-4">
          {steps.map(({ Icon, title, body }) => (
            <li
              key={title}
              className="rounded-[var(--radius-card)] border border-border bg-surface-1 p-5 shadow-[var(--shadow-sm)]"
            >
              <h3 className="flex items-center gap-2 text-base font-medium text-foreground">
                <Icon className="size-5 text-primary-strong" aria-hidden />
                {title}
              </h3>
              <p className="mt-2 max-w-[var(--measure)] text-sm text-muted-foreground">
                {body}
              </p>
            </li>
          ))}
        </ol>
      </section>

      <section aria-label={t('honesty.heading')} className="mb-12">
        <h2 className="mb-3 font-[family-name:var(--font-heading)] text-h3 font-semibold text-foreground">
          {t('honesty.heading')}
        </h2>
        <p className="max-w-[var(--measure)] text-base text-muted-foreground">
          {t('honesty.body')}
        </p>
      </section>

      <section aria-label={t('contact.heading')}>
        <h2 className="mb-4 font-[family-name:var(--font-heading)] text-h3 font-semibold text-foreground">
          {t('contact.heading')}
        </h2>
        <p className="max-w-[var(--measure)] text-base text-foreground">
          {t('contact.body', { email: t('contact.emailAddress') })
            .split(t('contact.emailAddress'))
            .map((part, i, arr) =>
              i < arr.length - 1 ? (
                <span key={i}>
                  {part}
                  <a
                    href={`mailto:${t('contact.emailAddress')}`}
                    className="font-medium text-primary-strong underline underline-offset-2"
                  >
                    {t('contact.emailAddress')}
                  </a>
                </span>
              ) : (
                <span key={i}>{part}</span>
              ),
            )}
        </p>
        <p className="mt-4">
          <Link
            href="/vendor/onboarding"
            className="inline-flex items-center font-medium text-primary-strong underline underline-offset-2"
          >
            {t('contact.vendorCta')}
          </Link>
        </p>
      </section>
    </main>
  )
}
