/**
 * Post-authentication redirect target validation.
 *
 * `/vendor/*` is auth-gated, so an anonymous visitor who clicks "Start Vendor
 * Onboarding" is bounced to `/sign-in`. Without carrying their intent, the
 * post-auth router sends the brand-new user to the customer dashboard (they
 * have no vendor_profiles row yet) and the vendor funnel dead-ends — no Vendor
 * record is created, and nothing ever appears in the admin dashboard.
 *
 * The fix carries a `next` path through sign-in. That path comes from the URL,
 * which makes it an open-redirect primitive: a "starts with /" check is not
 * enough, because `//evil.com` and `/\evil.com` are both browser-honoured
 * host-relative forms. So the target is ALLOWLISTED to the authenticated
 * surfaces that a post-auth redirect can legitimately land on.
 */

/**
 * Authenticated surfaces a sign-in redirect may target. A candidate must equal
 * one of these exactly or continue with `/`, `?` or `#` — so `/vendor` and
 * `/vendor/onboarding` pass while `/vendorsomething` does not.
 */
const ALLOWED_PREFIXES = ['/vendor', '/dashboard', '/admin'] as const

/** Anything that could terminate or smuggle a header/URL component. */
const FORBIDDEN_CHARS = /[\u0000-\u001f\u007f\\]/

/**
 * Return `next` when it is a safe same-origin path onto an authenticated
 * surface, otherwise `null` (meaning "fall through to role-based routing").
 */
export function sanitizeNextPath(next: string | null | undefined): string | null {
  if (!next) return null

  const candidate = next.trim()
  if (candidate.length === 0) return null

  // Must be an absolute path on this origin...
  if (!candidate.startsWith('/')) return null
  // ...but NOT a protocol-relative URL (`//host`), which browsers treat as
  // off-origin.
  if (candidate.startsWith('//')) return null
  // Backslashes and control characters are normalised by some browsers into
  // host separators or used to inject a second header line.
  if (FORBIDDEN_CHARS.test(candidate)) return null

  const pathEnd = candidate.search(/[?#]/)
  const pathname = pathEnd === -1 ? candidate : candidate.slice(0, pathEnd)

  const allowed = ALLOWED_PREFIXES.some(
    (prefix) =>
      pathname === prefix ||
      pathname.startsWith(`${prefix}/`),
  )

  return allowed ? candidate : null
}
