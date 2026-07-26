import { describe, expect, it } from 'vitest'

import { sanitizeReturnTo } from './return-to'

/**
 * Security boundary (launch-readiness 02). `returnTo` is attacker-
 * controllable (a query parameter fed to a client-callable Server
 * Action), and its output becomes a post-auth navigation target. The
 * sanitizer is the single guard against using the sign-in page as an
 * open redirect / phishing hop. Every rejection returns null — callers
 * fall back to role-based routing, never an error.
 */
describe('sanitizeReturnTo', () => {
  describe('rejects cross-origin and scheme-carrying values', () => {
    it.each([
      ['absolute https URL', 'https://evil.com/vendor/onboarding'],
      ['absolute http URL', 'http://evil.com'],
      ['protocol-relative', '//evil.com'],
      ['protocol-relative with path', '//evil.com/vendor/onboarding'],
      ['triple slash', '///evil.com'],
      ['backslash protocol-relative', '\\\\evil.com'],
      ['escaped-slash host form', '\\/evil.com'],
      ['slash-backslash host form', '/\\evil.com'],
      ['backslash anywhere in path', '/vendor\\evil'],
      ['javascript scheme', 'javascript:alert(1)'],
      ['javascript scheme with slashes', 'javascript://alert(1)'],
      ['data scheme', 'data:text/html,<script>alert(1)</script>'],
      ['mailto scheme', 'mailto:x@evil.com'],
      ['scheme-relative without slashes', 'evil.com/path'],
    ])('%s → null', (_label, raw) => {
      expect(sanitizeReturnTo(raw)).toBeNull()
    })
  })

  describe('rejects encoded smuggling and traversal', () => {
    it.each([
      ['encoded slash (lowercase)', '/%2f%2fevil.com'],
      ['encoded slash (uppercase)', '/%2F%2Fevil.com'],
      ['encoded backslash', '/%5cevil.com'],
      ['encoded backslash (uppercase)', '/%5Cevil.com'],
      ['raw dot-dot traversal', '/vendor/../admin'],
      ['trailing dot-dot', '/vendor/..'],
      ['encoded dot-dot traversal', '/vendor/%2e%2e/admin'],
      ['encoded dot-dot (uppercase)', '/%2E%2E/admin'],
      ['mixed encoded traversal', '/vendor/.%2e/admin'],
    ])('%s → null', (_label, raw) => {
      expect(sanitizeReturnTo(raw)).toBeNull()
    })
  })

  describe('rejects malformed and non-path values', () => {
    it.each([
      ['empty string', ''],
      ['whitespace only', '   '],
      ['tab only', '\t'],
      ['newline only', '\n'],
      ['missing leading slash', 'vendor/onboarding'],
      ['bare word', 'dashboard'],
      ['fragment only', '#section'],
      ['query only', '?returnTo=x'],
      ['embedded newline (header injection)', '/vendor\r\nSet-Cookie:x=1'],
      ['embedded null byte', '/vendor\u0000/onboarding'],
      ['embedded raw space', '/vendor /onboarding'],
      ['embedded tab', '/vendor\t/onboarding'],
    ])('%s → null', (_label, raw) => {
      expect(sanitizeReturnTo(raw)).toBeNull()
    })

    it.each([
      ['undefined', undefined],
      ['null', null],
      ['number', 42],
      ['object', { toString: () => '/dashboard' }],
      ['array', ['/dashboard']],
    ])('non-string input (%s) → null', (_label, raw) => {
      expect(sanitizeReturnTo(raw)).toBeNull()
    })

    it('rejects absurdly long values', () => {
      expect(sanitizeReturnTo('/' + 'a'.repeat(3000))).toBeNull()
    })
  })

  describe('accepts safe same-origin relative paths', () => {
    it.each([
      ['simple path', '/dashboard'],
      ['nested path', '/vendor/onboarding'],
      ['deeply nested path', '/vendor/listings/new/step'],
      ['trailing slash', '/vendor/onboarding/'],
      ['path with query string', '/vendor/onboarding?step=2'],
      ['path with multiple query params', '/search?activity=rafting&region=rishikesh'],
      ['path with fragment', '/vendor/onboarding#documents'],
      ['path with query and fragment', '/vendor/onboarding?step=2#documents'],
      ['path with encoded query value', '/search?q=river%20rafting'],
      ['path with hyphens and dots in segments', '/blog/monsoon-trek.2026'],
      ['root path', '/'],
    ])('%s → returned unchanged', (_label, raw) => {
      expect(sanitizeReturnTo(raw)).toBe(raw)
    })

    it('trims surrounding whitespace from an otherwise-valid path', () => {
      expect(sanitizeReturnTo('  /vendor/onboarding  ')).toBe('/vendor/onboarding')
    })
  })
})
