/**
 * Pure locale resolution logic, extracted for testability.
 *
 * Priority order (per ADR-0012):
 * 1. URL path prefix (requestLocale from middleware)
 * 2. Cookie value
 * 3. Accept-Language header
 * 4. Default locale ('en')
 */

import {
  DEFAULT_LOCALE,
  type SupportedLocale,
  isValidLocale,
} from './config'

export interface LocaleResolutionInput {
  /** Locale from the URL path prefix (provided by next-intl middleware). */
  readonly requestLocale: string | undefined
  /** Value of the 'locale' cookie. */
  readonly cookieLocale: string | undefined
  /** Raw Accept-Language header value. */
  readonly acceptLanguage: string | undefined
}

/**
 * Resolve the locale from available signals in priority order.
 * Returns the resolved SupportedLocale.
 */
export function resolveLocale(input: LocaleResolutionInput): SupportedLocale {
  // 1. URL path prefix
  if (isValidLocale(input.requestLocale)) {
    return input.requestLocale
  }

  // 2. Cookie
  if (isValidLocale(input.cookieLocale)) {
    return input.cookieLocale
  }

  // 3. Accept-Language header (sorted by quality value per RFC 7231 §5.3.5)
  if (input.acceptLanguage) {
    const match = input.acceptLanguage
      .split(',')
      .map((part) => {
        const [lang, ...params] = part.trim().split(';')
        const qParam = params.find((p) => p.trim().startsWith('q='))
        const q = qParam ? parseFloat(qParam.trim().slice(2)) : 1.0
        return { code: lang.trim().split('-')[0], q }
      })
      .sort((a, b) => b.q - a.q)
      .map(({ code }) => code)
      .find((code): code is SupportedLocale => isValidLocale(code))
    if (match) return match
  }

  // 4. Default
  return DEFAULT_LOCALE
}
