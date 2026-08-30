/**
 * Brand-coupled values: the product name, its public domain, and the support /
 * admin addresses derived from that domain.
 *
 * These used to be hardcoded in ~200 places (message catalogues for 13 locales,
 * footer, marketing copy, seed data), which made a rebrand a repo-wide sweep.
 * They are templated instead: message strings carry `{supportEmail}`-style
 * placeholders and `lib/i18n/request.ts` substitutes them once at message-load
 * time, so no `t()` call site has to pass them.
 *
 * Pure + env-injected (matching ./origins.ts) so this can be unit-tested and
 * imported from anywhere without pulling in an env-validating module. The
 * NEXT_PUBLIC_ prefix means these are inlined at BUILD time — a change needs a
 * rebuild, not just a restart.
 */
export type BrandTokens = {
  brandName: string
  appDomain: string
  supportEmail: string
  adminEmail: string
}

const DEFAULT_BRAND_NAME = 'Switchback'
const DEFAULT_APP_DOMAIN = 'switchback.com'

type EnvLike = Partial<Record<string, string | undefined>>

/** Treat a blank/whitespace env value as absent, not as an empty address. */
function present(value: string | undefined): string | undefined {
  const trimmed = value?.trim()
  return trimmed ? trimmed : undefined
}

export function resolveBrandTokens(env: EnvLike): BrandTokens {
  const appDomain = present(env.NEXT_PUBLIC_APP_DOMAIN) ?? DEFAULT_APP_DOMAIN
  return {
    brandName: present(env.NEXT_PUBLIC_BRAND_NAME) ?? DEFAULT_BRAND_NAME,
    appDomain,
    supportEmail: present(env.NEXT_PUBLIC_SUPPORT_EMAIL) ?? `support@${appDomain}`,
    adminEmail: present(env.NEXT_PUBLIC_ADMIN_EMAIL) ?? `admin@${appDomain}`,
  }
}

/**
 * The resolved tokens for this build. Import this from components (client ones
 * included) rather than calling `resolveBrandTokens(process.env)` yourself:
 * Next inlines only STATIC `process.env.NEXT_PUBLIC_X` references at build
 * time, so a dynamic lookup on `process.env` resolves to `{}` in the browser
 * and would silently fall back to the defaults. The four reads below are
 * static on purpose — do not collapse them into a loop.
 */
export const BRAND: BrandTokens = resolveBrandTokens({
  NEXT_PUBLIC_BRAND_NAME: process.env.NEXT_PUBLIC_BRAND_NAME,
  NEXT_PUBLIC_APP_DOMAIN: process.env.NEXT_PUBLIC_APP_DOMAIN,
  NEXT_PUBLIC_SUPPORT_EMAIL: process.env.NEXT_PUBLIC_SUPPORT_EMAIL,
  NEXT_PUBLIC_ADMIN_EMAIL: process.env.NEXT_PUBLIC_ADMIN_EMAIL,
})

/**
 * Only these four names are substituted. Anything else in braces — `{count}`,
 * `{date}`, ICU plural forms — is left verbatim for next-intl to resolve at
 * `t()` time; clobbering those would break interpolation catalogue-wide.
 */
const BRAND_PLACEHOLDER = /\{(brandName|appDomain|supportEmail|adminEmail)\}/g

/** Recursively substitute brand placeholders, returning a new structure. */
export function applyBrandTokens<T>(value: T, tokens: BrandTokens): T {
  if (typeof value === 'string') {
    return value.replace(
      BRAND_PLACEHOLDER,
      (_match, name: keyof BrandTokens) => tokens[name],
    ) as T
  }
  if (Array.isArray(value)) {
    return value.map((entry) => applyBrandTokens(entry, tokens)) as T
  }
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, applyBrandTokens(entry, tokens)]),
    ) as T
  }
  return value
}
