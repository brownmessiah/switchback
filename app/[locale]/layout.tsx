import { notFound } from 'next/navigation'
import { getMessages, setRequestLocale } from 'next-intl/server'
import type { ReactNode } from 'react'

import { SUPPORTED_LOCALES, isValidLocale } from '@/lib/i18n/config'
import { IntlProvider } from '@/lib/i18n/provider'

type Props = {
  readonly children: ReactNode
  readonly params: Promise<{ locale: string }>
}

export function generateStaticParams() {
  return SUPPORTED_LOCALES.map((locale) => ({ locale }))
}

export default async function LocaleLayout({ children, params }: Props) {
  const { locale } = await params

  // Validate the locale from the URL segment
  if (!isValidLocale(locale)) {
    notFound()
  }

  // Enable static rendering for this locale
  setRequestLocale(locale)

  // Load messages for the IntlProvider
  const messages = await getMessages()

  return (
    <IntlProvider locale={locale} messages={messages as Record<string, unknown>}>
      {children}
    </IntlProvider>
  )
}
