/**
 * Server-side request configuration for next-intl.
 *
 * Locale resolution priority (per ADR-0012):
 * 1. URL path prefix (provided by next-intl middleware as requestLocale)
 * 2. Cookie value
 * 3. Accept-Language header
 * 4. Default locale ('en')
 */

import { getRequestConfig } from 'next-intl/server'
import { cookies, headers } from 'next/headers'
import { BRAND, applyBrandTokens } from '../config/brand'
import { resolveLocale } from './resolve-locale'

export default getRequestConfig(async ({ requestLocale }) => {
  const cookieStore = await cookies()
  const headerStore = await headers()

  const locale = resolveLocale({
    requestLocale: await requestLocale,
    cookieLocale: cookieStore.get('locale')?.value,
    acceptLanguage: headerStore.get('accept-language') ?? undefined,
  })

  // Substitute {supportEmail}/{adminEmail}/{brandName} once here, so the
  // catalogues stay brand-agnostic and no t() call site has to pass them.
  // next-intl v4 dropped defaultTranslationValues, hence load-time expansion.
  const messages = applyBrandTokens(
    (await import(`./messages/${locale}.json`)).default,
    BRAND,
  )
  return { locale, messages, timeZone: 'Asia/Kolkata' }
})
