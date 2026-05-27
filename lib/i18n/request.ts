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
import { resolveLocale } from './resolve-locale'

export default getRequestConfig(async ({ requestLocale }) => {
  const cookieStore = await cookies()
  const headerStore = await headers()

  const locale = resolveLocale({
    requestLocale: await requestLocale,
    cookieLocale: cookieStore.get('locale')?.value,
    acceptLanguage: headerStore.get('accept-language') ?? undefined,
  })

  const messages = (await import(`./messages/${locale}.json`)).default
  return { locale, messages, timeZone: 'Asia/Kolkata' }
})
