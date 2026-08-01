import { describe, expect, it } from 'vitest'

import { sanitizeNextPath } from './post-auth-redirect'

/**
 * The vendor funnel used to lose the visitor's intent: `/vendor/onboarding`
 * bounced an anonymous visitor to `/sign-in` with no return path, and
 * post-auth routing then sent the brand-new user to the CUSTOMER dashboard
 * because they had no vendor_profiles row yet. They never reached the
 * onboarding wizard, so no Vendor record was ever created and they were
 * invisible to the admin dashboard.
 *
 * Carrying a `next` path fixes that — but a redirect target taken from the
 * URL is an open-redirect primitive, so it is allowlisted, not merely
 * "checked for a leading slash".
 */

describe('sanitizeNextPath', () => {
  it('keeps a vendor onboarding path', () => {
    expect(sanitizeNextPath('/vendor/onboarding')).toBe('/vendor/onboarding')
  })

  it('keeps a query string on an allowed path', () => {
    expect(sanitizeNextPath('/vendor/listings?status=draft')).toBe(
      '/vendor/listings?status=draft',
    )
  })

  it('keeps the customer dashboard', () => {
    expect(sanitizeNextPath('/dashboard')).toBe('/dashboard')
  })

  it('rejects a protocol-relative URL', () => {
    expect(sanitizeNextPath('//evil.com/x')).toBeNull()
  })

  it('rejects an absolute URL', () => {
    expect(sanitizeNextPath('https://evil.com/x')).toBeNull()
  })

  it('rejects a backslash-smuggled host', () => {
    expect(sanitizeNextPath('/\\evil.com')).toBeNull()
    expect(sanitizeNextPath('\\/evil.com')).toBeNull()
  })

  it('rejects a path outside the allowlist', () => {
    expect(sanitizeNextPath('/experience/some-slug')).toBeNull()
  })

  it('rejects a prefix-lookalike path', () => {
    // `/vendorsomething` must not pass on the strength of the `/vendor` prefix.
    expect(sanitizeNextPath('/vendorsomething')).toBeNull()
  })

  it('rejects a relative path with no leading slash', () => {
    expect(sanitizeNextPath('vendor/onboarding')).toBeNull()
  })

  it('rejects control characters used to break out of the header', () => {
    expect(sanitizeNextPath('/vendor/onboarding\nLocation: https://evil.com')).toBeNull()
  })

  it('treats missing or empty input as no redirect', () => {
    expect(sanitizeNextPath(undefined)).toBeNull()
    expect(sanitizeNextPath(null)).toBeNull()
    expect(sanitizeNextPath('')).toBeNull()
    expect(sanitizeNextPath('   ')).toBeNull()
  })
})
