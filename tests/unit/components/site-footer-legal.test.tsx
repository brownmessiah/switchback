import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Footer wiring for the four legal pages (issue 07).
 *
 * The footer must expose /terms, /privacy, /refund-cancellation and
 * /vendor-terms alongside the existing /cancellation-policy link, all inside
 * the "Footer navigation" landmark, so the legal drafts are reachable from
 * every public page. Translation keys are returned verbatim by the mock so we
 * assert by i18n key, not translated copy.
 */

vi.mock('next-intl', () => ({
  useTranslations:
    (ns: string) =>
    (key: string) =>
      ns ? `${ns}.${key}` : key,
}))

let mockPathname = '/'
vi.mock('next/navigation', () => ({
  usePathname: () => mockPathname,
}))

vi.mock('@/components/language-selector', () => ({
  LanguageSelector: () => <div data-testid="language-selector" />,
}))
vi.mock('@/components/newsletter-form', () => ({
  NewsletterForm: () => <div data-testid="newsletter-form" />,
}))

import { SiteFooter } from '@/components/site-footer'

afterEach(() => {
  cleanup()
})

beforeEach(() => {
  mockPathname = '/'
})

function getFooterNav(): HTMLElement {
  return screen.getByRole('navigation', { name: 'Footer navigation' })
}

const LEGAL_LINKS: ReadonlyArray<{ key: string; href: string }> = [
  { key: 'Nav.footer.terms', href: '/terms' },
  { key: 'Nav.footer.privacy', href: '/privacy' },
  { key: 'Nav.footer.refundCancellation', href: '/refund-cancellation' },
  { key: 'Nav.footer.vendorTerms', href: '/vendor-terms' },
]

describe('SiteFooter — legal links (issue 07)', () => {
  for (const { key, href } of LEGAL_LINKS) {
    it(`links ${href} inside Footer navigation`, () => {
      render(<SiteFooter />)
      const nav = getFooterNav()
      expect(within(nav).getByRole('link', { name: key })).toHaveAttribute('href', href)
    })
  }

  it('keeps the existing /cancellation-policy link', () => {
    render(<SiteFooter />)
    const nav = getFooterNav()
    expect(
      within(nav).getByRole('link', { name: 'Nav.refundPolicy' }),
    ).toHaveAttribute('href', '/cancellation-policy')
  })
})
