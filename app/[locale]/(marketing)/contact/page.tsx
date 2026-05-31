import type { Metadata } from 'next'
import Link from 'next/link'
import type { ReactElement } from 'react'
import { getTranslations, setRequestLocale } from 'next-intl/server'

import { env } from '@/lib/env'
import { generateAlternates } from '@/lib/seo/hreflang'
import { breadcrumbList } from '@/lib/seo/schemas/breadcrumb-list'

import { ContactForm } from './contact-form'

/**
 * /contact — a lead form that creates a real `support_ticket` under the
 * dedicated guest-contact system User (Issue 07, Decision 2). SSR shell with
 * the form rendered as a client island; metadata + hreflang + BreadcrumbList
 * JSON-LD per ADR-0013.
 */

interface PageProps {
  params: Promise<{ locale: string }>
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { locale } = await params
  const t = await getTranslations({ locale, namespace: 'ContactPage' })
  return {
    title: t('metadata.title'),
    description: t('metadata.description'),
    alternates: generateAlternates('/contact', locale),
  }
}

export default async function ContactPage({ params }: PageProps): Promise<ReactElement> {
  const { locale } = await params
  setRequestLocale(locale)

  const t = await getTranslations({ locale, namespace: 'ContactPage' })
  const tCommon = await getTranslations({ locale, namespace: 'Common' })

  const baseUrl = env.NEXT_PUBLIC_APP_URL.replace(/\/$/, '')
  const breadcrumbsJson = breadcrumbList([
    { name: tCommon('breadcrumb.home'), url: `${baseUrl}/` },
    { name: t('breadcrumb.contact'), url: `${baseUrl}/contact` },
  ])

  return (
    <main className="mx-auto max-w-2xl px-4 py-12 sm:px-6 sm:py-16">
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
          {t('breadcrumb.contact')}
        </span>
      </nav>

      <header className="mb-8">
        <h1 className="font-[family-name:var(--font-heading)] text-h1 font-semibold text-foreground">
          {t('hero.title')}
        </h1>
        <p className="mt-4 max-w-[var(--measure)] text-base text-muted-foreground">
          {t('hero.description')}
        </p>
      </header>

      <ContactForm />

      <p className="mt-8 max-w-[var(--measure)] text-sm text-muted-foreground">
        {t('helpHint')}{' '}
        <Link
          href="/help"
          className="font-medium text-primary-strong underline underline-offset-2"
        >
          {t('helpHintLink')}
        </Link>
        .
      </p>
    </main>
  )
}
