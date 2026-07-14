/**
 * i18n configuration — locale constants, cookie helpers, and detection.
 *
 * Five infrastructure-supported locales per ADR-0012.
 * en is the canonical/un-prefixed locale; hi is the second launch locale.
 * ta, mr, bn are infrastructure-supported with content rolling in across v1.x.
 */

export const SUPPORTED_LOCALES = ['en', 'hi', 'ta', 'te', 'kn', 'bn', 'mr', 'ml', 'gu', 'pa', 'or', 'as', 'ur'] as const

export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number]

export const DEFAULT_LOCALE: SupportedLocale = 'en'

/**
 * Launch locales — the locales exposed in the language selector, sitemaps,
 * and hreflang alternates.
 *
 * 2026-07-14 (amends ADR-0012's v1 posture): originally `en + hi` only,
 * with the rest "hidden until they have content". All 13 locale files are
 * now fully translated (≈1,900 remaining en-identical values were hand-
 * reviewed/translated in the pre-merge i18n pass), so every supported
 * locale launches. The selector, sitemap, and hreflang all derive from
 * this constant — no other code change was needed (the designed extension
 * point).
 */
export const LAUNCH_LOCALES = SUPPORTED_LOCALES

export type LaunchLocale = (typeof LAUNCH_LOCALES)[number]

export const LOCALE_NAMES: Record<SupportedLocale, string> = {
  en: 'English',
  hi: 'हिन्दी',
  ta: 'தமிழ்',
  te: 'తెలుగు',
  kn: 'ಕನ್ನಡ',
  bn: 'বাংলা',
  mr: 'मराठी',
  ml: 'മലയാളം',
  gu: 'ગુજરાતી',
  pa: 'ਪੰਜਾਬੀ',
  or: 'ଓଡ଼ିଆ',
  as: 'অসমীয়া',
  ur: 'اردو',
}

/** Type guard — returns true when the given string is a supported locale code. */
export function isValidLocale(value: unknown): value is SupportedLocale {
  if (typeof value !== 'string' || value === '') return false
  return (SUPPORTED_LOCALES as readonly string[]).includes(value)
}

/** Read the current locale from the browser cookie, or return DEFAULT_LOCALE. */
export function getLocaleFromCookie(): SupportedLocale {
  if (typeof document === 'undefined') return DEFAULT_LOCALE
  const match = document.cookie.match(/(?:^|;\s*)locale=([^;]*)/)
  const value = match?.[1]
  if (value && isValidLocale(value)) {
    return value
  }
  return DEFAULT_LOCALE
}

/** Set the locale cookie (max-age 1 year, SameSite=Lax). */
export function setLocaleCookie(locale: SupportedLocale): void {
  const secure = typeof location !== 'undefined' && location.protocol === 'https:' ? ';Secure' : ''
  document.cookie = `locale=${locale};path=/;max-age=31536000;SameSite=Lax${secure}`
}

/**
 * Detect locale from localStorage override, then browser languages, then default.
 * This is a client-side helper; server-side resolution is in request.ts.
 */
export function detectLocale(): SupportedLocale {
  // 1. Check localStorage override
  if (typeof localStorage !== 'undefined') {
    const stored = localStorage.getItem('locale')
    if (isValidLocale(stored)) {
      return stored
    }
  }

  // 2. Check browser language preferences
  if (typeof navigator !== 'undefined') {
    for (const lang of navigator.languages ?? [navigator.language]) {
      const code = lang.split('-')[0]
      if (isValidLocale(code)) return code
    }
  }

  return DEFAULT_LOCALE
}
