'use client'

/**
 * IntlProvider — wraps NextIntlClientProvider and provides a useIntl() hook
 * that exposes the current locale and a switchLocale() function.
 *
 * For server components, use getLocale() from next-intl/server instead.
 */

import { NextIntlClientProvider } from 'next-intl'
import { usePathname } from 'next/navigation'
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  type ReactNode,
} from 'react'

import { type SupportedLocale, setLocaleCookie, isValidLocale, DEFAULT_LOCALE } from './config'

interface IntlContextValue {
  readonly locale: SupportedLocale
  readonly switchLocale: (newLocale: SupportedLocale) => void
}

const IntlContext = createContext<IntlContextValue | null>(null)

/**
 * Access the current locale and a function to switch locales.
 * Must be used within an IntlProvider.
 */
export function useIntl(): IntlContextValue {
  const ctx = useContext(IntlContext)
  if (!ctx) {
    throw new Error('useIntl must be used within an IntlProvider')
  }
  return ctx
}

interface IntlProviderProps {
  readonly locale: string
  readonly messages: Record<string, unknown>
  readonly children: ReactNode
}

/**
 * Client-side i18n provider. Wraps NextIntlClientProvider and adds
 * locale switching via the useIntl() hook.
 */
export function IntlProvider({ locale, messages, children }: IntlProviderProps) {
  const pathname = usePathname()

  const validLocale: SupportedLocale = isValidLocale(locale)
    ? locale
    : DEFAULT_LOCALE

  const switchLocale = useCallback(
    (newLocale: SupportedLocale) => {
      setLocaleCookie(newLocale)

      if (typeof document !== 'undefined') {
        document.documentElement.lang = newLocale
        document.documentElement.setAttribute('data-locale', newLocale)
      }

      const pathWithoutLocale = pathname.replace(
        new RegExp(`^/${validLocale}(?=/|$)`),
        '',
      )
      const newPath =
        newLocale === DEFAULT_LOCALE
          ? pathWithoutLocale || '/'
          : `/${newLocale}${pathWithoutLocale || '/'}`

      // Full navigation (not router.push): the locale-dependent chrome — the
      // SiteHeader nav + the Devanagari font, both gated in the PERSISTENT root
      // layout — does not re-render on a soft client navigation, so the nav
      // stayed in the old language and Hindi fell back to the Latin font. A
      // hard navigation re-renders the root layout with the new locale (cookie
      // already set above), making the switch consistent everywhere.
      if (typeof window !== 'undefined') {
        window.location.assign(newPath)
      }
    },
    [pathname, validLocale],
  )

  const value = useMemo<IntlContextValue>(
    () => ({ locale: validLocale, switchLocale }),
    [validLocale, switchLocale],
  )

  return (
    <NextIntlClientProvider
      locale={validLocale}
      messages={messages}
      timeZone="Asia/Kolkata"
    >
      <IntlContext value={value}>{children}</IntlContext>
    </NextIntlClientProvider>
  )
}
