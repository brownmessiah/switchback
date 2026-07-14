import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { glob } from 'glob'

/**
 * Home-redesign issue 03 (CR10): the footer brand band carries the brand
 * tagline "Outvers - Your Adventure Partner" directly beneath the wordmark.
 * A dedicated `Nav.footer.brandTagline` key is used — the pre-existing
 * descriptive `Nav.footer.tagline` (keyword-bearing SEO copy) stays.
 */

vi.mock('next-intl', () => ({
  useTranslations:
    (ns: string) =>
    (key: string) =>
      ns ? `${ns}.${key}` : key,
}))

vi.mock('next/navigation', () => ({
  usePathname: () => '/',
}))

vi.mock('@/components/language-selector', () => ({
  LanguageSelector: () => <div data-testid="language-selector" />,
}))
vi.mock('@/components/newsletter-form', () => ({
  NewsletterForm: () => <div data-testid="newsletter-form" />,
}))

import { SiteFooter } from '@/components/site-footer'
import { SUPPORTED_LOCALES } from '@/lib/i18n/config'

afterEach(() => {
  cleanup()
})

const ROOT = resolve(__dirname, '../../..')

describe('SiteFooter — brand tagline (issue 03 / CR10)', () => {
  it('renders the brand tagline beneath the wordmark, before the descriptive tagline', () => {
    render(<SiteFooter />)

    const brandTagline = screen.getByText('Nav.footer.brandTagline')
    const descriptive = screen.getByText('Nav.footer.tagline')
    expect(brandTagline).toBeTruthy()
    expect(descriptive).toBeTruthy()

    // DOM order: wordmark link, then brand tagline, then descriptive tagline.
    const wordmark = screen.getByRole('link', { name: 'Nav.homeAriaLabel' })
    expect(
      wordmark.compareDocumentPosition(brandTagline) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
    expect(
      brandTagline.compareDocumentPosition(descriptive) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
  })

  it('en.json pins the exact brand tagline copy', () => {
    const en = JSON.parse(
      readFileSync(resolve(ROOT, 'lib/i18n/messages/en.json'), 'utf-8'),
    ) as { Nav: { footer: Record<string, unknown> } }
    expect(en.Nav.footer.brandTagline).toBe('Outvers - Your Adventure Partner')
  })

  it('every locale carries a non-empty Nav.footer.brandTagline', () => {
    const paths = glob.sync('lib/i18n/messages/*.json', { cwd: ROOT })
    expect(paths.length).toBe(SUPPORTED_LOCALES.length)
    for (const p of paths) {
      const json = JSON.parse(readFileSync(resolve(ROOT, p), 'utf-8')) as {
        Nav?: { footer?: Record<string, unknown> }
      }
      const value = json.Nav?.footer?.brandTagline
      expect(typeof value, `${p} missing Nav.footer.brandTagline`).toBe('string')
      expect((value as string).length).toBeGreaterThan(0)
      // Latin brand name + the exact spaced-hyphen separator in every locale
      // (guards against en-dash / colon drift in future locale edits).
      expect(value as string).toContain('Outvers - ')
    }
  })
})
