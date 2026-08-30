import { describe, expect, it } from 'vitest'

import { BRAND, applyBrandTokens, resolveBrandTokens } from './brand'

/**
 * Brand-coupled values (support address, admin address, product name, public
 * domain) are templated rather than hardcoded so a rebrand is a config change,
 * not a 200-file sweep. Pure + env-injected, matching ./origins.ts.
 */
describe('resolveBrandTokens', () => {
  it('falls back to the shipped defaults when nothing is configured', () => {
    expect(resolveBrandTokens({})).toEqual({
      brandName: 'Switchback',
      appDomain: 'switchback.com',
      supportEmail: 'support@switchback.com',
      adminEmail: 'admin@switchback.com',
    })
  })

  it('prefers explicit env overrides over the defaults', () => {
    const tokens = resolveBrandTokens({
      NEXT_PUBLIC_BRAND_NAME: 'Trailhead',
      NEXT_PUBLIC_APP_DOMAIN: 'trailhead.in',
      NEXT_PUBLIC_SUPPORT_EMAIL: 'help@trailhead.in',
      NEXT_PUBLIC_ADMIN_EMAIL: 'ops@trailhead.in',
    })
    expect(tokens.brandName).toBe('Trailhead')
    expect(tokens.appDomain).toBe('trailhead.in')
    expect(tokens.supportEmail).toBe('help@trailhead.in')
    expect(tokens.adminEmail).toBe('ops@trailhead.in')
  })

  it('derives the support and admin addresses from the domain when only the domain is set', () => {
    const tokens = resolveBrandTokens({ NEXT_PUBLIC_APP_DOMAIN: 'trailhead.in' })
    expect(tokens.supportEmail).toBe('support@trailhead.in')
    expect(tokens.adminEmail).toBe('admin@trailhead.in')
  })

  it('ignores blank env values rather than emitting an empty address', () => {
    const tokens = resolveBrandTokens({ NEXT_PUBLIC_SUPPORT_EMAIL: '   ' })
    expect(tokens.supportEmail).toBe('support@switchback.com')
  })
})

describe('BRAND', () => {
  // Client components cannot call resolveBrandTokens(process.env): Next inlines
  // only STATIC process.env.NEXT_PUBLIC_X references at build, so a dynamic
  // lookup yields {} in the browser. BRAND is the statically-built constant.
  it('exposes ready-resolved tokens for direct import', () => {
    expect(BRAND.brandName).toBe('Switchback')
    expect(BRAND.supportEmail).toBe('support@switchback.com')
    expect(BRAND.adminEmail).toBe('admin@switchback.com')
    expect(BRAND.appDomain).toBe('switchback.com')
  })
})

describe('applyBrandTokens', () => {
  const tokens = resolveBrandTokens({})

  it('substitutes a brand placeholder inside a flat message', () => {
    expect(applyBrandTokens({ line: 'Write to {supportEmail} for help.' }, tokens)).toEqual({
      line: 'Write to support@switchback.com for help.',
    })
  })

  it('substitutes through nested message namespaces', () => {
    const out = applyBrandTokens(
      { footer: { support: { body: 'Reach {brandName} at {supportEmail}.' } } },
      tokens,
    )
    expect(out.footer.support.body).toBe('Reach Switchback at support@switchback.com.')
  })

  it('replaces every occurrence of the same placeholder', () => {
    expect(applyBrandTokens({ s: '{supportEmail} or {supportEmail}' }, tokens).s).toBe(
      'support@switchback.com or support@switchback.com',
    )
  })

  it('leaves ICU placeholders it does not own untouched', () => {
    // `{count}` is resolved by next-intl at t() time — clobbering it here would
    // break pluralisation and interpolation across the message catalogue.
    expect(applyBrandTokens({ s: '{count} seats — mail {supportEmail}' }, tokens).s).toBe(
      '{count} seats — mail support@switchback.com',
    )
  })

  it('does not mutate the input catalogue', () => {
    const input = { a: { b: 'mail {supportEmail}' } }
    const out = applyBrandTokens(input, tokens)
    expect(input.a.b).toBe('mail {supportEmail}')
    expect(out).not.toBe(input)
  })
})
