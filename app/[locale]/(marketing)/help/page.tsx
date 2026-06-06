import type { Metadata } from 'next'
import Link from 'next/link'
import type { ReactElement } from 'react'
import { getTranslations, setRequestLocale } from 'next-intl/server'

import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion'
import { env } from '@/lib/env'
import { generateAlternates } from '@/lib/seo/hreflang'
import { breadcrumbList } from '@/lib/seo/schemas/breadcrumb-list'
import { faqPage } from '@/lib/seo/schemas/faq-page'

/**
 * /help — a static, i18n-backed FAQ help centre (Issue 07, Decision 1).
 *
 * FAQ content is STATIC (no CMS, no new schema) — the Q&As live in the
 * `HelpPage` i18n namespace, grounded in real Outvers features (booking,
 * cancellation/refund presets, two-bucket Wallet, Partial pay, KYC-verified
 * Vendors, Required permits + Safety stack). Rendered as an accordion and
 * emitted as FAQPage JSON-LD (plain-text answers) per ADR-0013, alongside a
 * BreadcrumbList. Metadata + hreflang on every locale.
 */

interface PageProps {
  params: Promise<{ locale: string }>
}

/** The 9 FAQ entries, by stable key. Q + A text come from i18n. */
const FAQ_KEYS = [
  'whatIsOutvers',
  'howToBook',
  'partialPay',
  'cancellation',
  'refundBalance',
  'walletBuckets',
  'vendorVerification',
  'permits',
  'safetyStack',
] as const

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { locale } = await params
  const t = await getTranslations({ locale, namespace: 'HelpPage' })
  return {
    title: t('metadata.title'),
    description: t('metadata.description'),
    alternates: generateAlternates('/help', locale),
  }
}

export default async function HelpPage({ params }: PageProps): Promise<ReactElement> {
  const { locale } = await params
  setRequestLocale(locale)

  const t = await getTranslations({ locale, namespace: 'HelpPage' })
  const tCommon = await getTranslations({ locale, namespace: 'Common' })

  const faqItems = FAQ_KEYS.map((key) => ({
    question: t(`faq.${key}.question`),
    answer: t(`faq.${key}.answer`),
  }))
  const faqJson = faqPage(faqItems)

  const baseUrl = env.NEXT_PUBLIC_APP_URL.replace(/\/$/, '')
  const breadcrumbsJson = breadcrumbList([
    { name: tCommon('breadcrumb.home'), url: `${baseUrl}/` },
    { name: t('breadcrumb.help'), url: `${baseUrl}/help` },
  ])

  return (
    <main className="mx-auto max-w-3xl px-4 py-12 sm:px-6 sm:py-16">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(faqJson) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbsJson) }}
      />

      <nav aria-label="Breadcrumb" className="mb-4 text-sm text-muted-foreground">
        <Link href="/" className="transition-colors hover:text-primary-strong">
          {tCommon('breadcrumb.home')}
        </Link>{' '}
        <span aria-hidden>&#8250;</span>{' '}
        <span aria-current="page" className="text-foreground">
          {t('breadcrumb.help')}
        </span>
      </nav>

      <header className="mb-10">
        <h1 className="font-[family-name:var(--font-heading)] text-h1 font-semibold text-foreground">
          {t('hero.title')}
        </h1>
        <p className="mt-4 max-w-[var(--measure)] text-base text-muted-foreground">
          {t('hero.description')}
        </p>
      </header>

      <section aria-label={t('hero.title')}>
        <Accordion multiple className="w-full">
          {faqItems.map((item, i) => (
            <AccordionItem key={FAQ_KEYS[i]} value={FAQ_KEYS[i]}>
              <AccordionTrigger className="text-left text-base font-medium">
                {item.question}
              </AccordionTrigger>
              <AccordionContent className="text-sm text-muted-foreground">
                {item.answer}
              </AccordionContent>
            </AccordionItem>
          ))}
        </Accordion>
      </section>

      <section className="mt-12 rounded-[var(--radius-card)] border border-border bg-surface-1 p-6 shadow-[var(--shadow-sm)]">
        <h2 className="font-[family-name:var(--font-heading)] text-h3 font-semibold text-foreground">
          {t('stillStuck.title')}
        </h2>
        <p className="mt-2 max-w-[var(--measure)] text-sm text-muted-foreground">
          {t('stillStuck.body')}
        </p>
        <Link
          href="/contact"
          className="min-tap mt-4 inline-flex h-11 items-center justify-center rounded-[var(--radius-control)] bg-primary px-6 text-sm font-medium text-primary-foreground transition hover:bg-primary-strong focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
        >
          {t('stillStuck.cta')}
        </Link>
      </section>
    </main>
  )
}
