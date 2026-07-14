import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// ---- Mocks ----
// `useTranslations('Nav')` returns the key verbatim so we can assert links by
// their i18n key without coupling to translated copy.
vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
}))

let mockPathname = '/'
vi.mock('next/navigation', () => ({
  usePathname: () => mockPathname,
}))

// Heavy chrome children carry their own auth/session/router deps — stub them
// to keep this a focused nav-structure test.
vi.mock('@/components/auth-status', () => ({
  AuthStatus: () => <div data-testid="auth-status" />,
}))
vi.mock('@/components/language-selector', () => ({
  LanguageSelector: () => <div data-testid="language-selector" />,
}))
vi.mock('@/components/theme-toggle', () => ({
  ThemeToggle: () => <button type="button">theme</button>,
}))

import { SiteHeader } from '@/components/site-header'

afterEach(() => {
  cleanup()
})

beforeEach(() => {
  mockPathname = '/'
})

/**
 * Customer-centric header contract (home-redesign issue 06 / CR4, decision
 * D3 — supersedes the 2026-06-11 minimal bar that carried the vendor CTA):
 * wordmark + Wishlist + theme/locale utilities + a static "₹ INR" currency
 * badge (decision D5 — locale switch stays FUNCTIONAL, currency is
 * decorative) + the auth control. The supply-side "List your experience"
 * CTA is gone from the header — vendors enter via the footer's "For
 * Vendors" column. Discovery links stay out (footer carries them).
 */
const REMOVED_DISCOVERY_KEYS = [
  'explore',
  'destinations',
  'activities',
  'safety',
  'blog',
  'community',
  'experiences',
] as const

describe('SiteHeader — customer-centric bar (issue 06 / D3)', () => {
  it('renders the wordmark linking home', () => {
    render(<SiteHeader />)
    expect(screen.getByRole('link', { name: 'homeAriaLabel' })).toHaveAttribute(
      'href',
      '/',
    )
  })

  it('no longer renders the vendor "List your experience" CTA anywhere', () => {
    render(<SiteHeader />)
    expect(
      screen.queryByRole('link', { name: 'listYourExperience' }),
    ).not.toBeInTheDocument()
    expect(screen.queryByText('listYourExperience')).not.toBeInTheDocument()
  })

  it('renders NO discovery links in the header at all', () => {
    render(<SiteHeader />)
    for (const key of REMOVED_DISCOVERY_KEYS) {
      expect(
        screen.queryByRole('link', { name: key }),
      ).not.toBeInTheDocument()
    }
  })

  it('renders a Wishlist link → /wishlist on the desktop bar', () => {
    render(<SiteHeader />)
    const nav = screen.getByRole('navigation', { name: 'Primary' })
    expect(within(nav).getByRole('link', { name: 'wishlist' })).toHaveAttribute(
      'href',
      '/wishlist',
    )
  })

  it('shows the static "₹ INR" currency badge beside the functional language selector (D5)', () => {
    render(<SiteHeader />)
    const nav = screen.getByRole('navigation', { name: 'Primary' })
    expect(within(nav).getByText('currencyBadge')).toBeInTheDocument()
    // The language selector stays MOUNTED and functional (ADR-0012) — the
    // badge is a sibling, not a replacement.
    expect(
      within(nav).getByTestId('language-selector'),
    ).toBeInTheDocument()
  })

  it('keeps the utilities: theme toggle, language selector, AuthStatus', () => {
    render(<SiteHeader />)
    expect(screen.getByTestId('auth-status')).toBeInTheDocument()
    expect(screen.getAllByTestId('language-selector').length).toBeGreaterThan(0)
    expect(screen.getAllByRole('button', { name: 'theme' }).length).toBeGreaterThan(0)
  })

  it('returns null inside the back-office (e.g. /admin)', () => {
    mockPathname = '/admin/dashboard'
    const { container } = render(<SiteHeader />)
    expect(container).toBeEmptyDOMElement()
  })
})

describe('SiteHeader — mobile menu mirrors the customer-centric bar', () => {
  function getMobileNav(): HTMLElement {
    return screen.getByRole('navigation', { name: 'Mobile primary' })
  }

  it('carries Wishlist + Sign in (no vendor CTA, no discovery links)', () => {
    render(<SiteHeader />)
    const nav = getMobileNav()
    expect(within(nav).getByRole('link', { name: 'wishlist' })).toHaveAttribute(
      'href',
      '/wishlist',
    )
    expect(within(nav).getByRole('link', { name: 'signIn' })).toHaveAttribute(
      'href',
      '/sign-in',
    )
    expect(
      within(nav).queryByRole('link', { name: 'listYourExperience' }),
    ).not.toBeInTheDocument()
    for (const key of REMOVED_DISCOVERY_KEYS) {
      expect(
        within(nav).queryByRole('link', { name: key }),
      ).not.toBeInTheDocument()
    }
  })

  it('shows the "₹ INR" badge in the mobile utilities row too', () => {
    render(<SiteHeader />)
    const nav = getMobileNav()
    expect(within(nav).getByText('currencyBadge')).toBeInTheDocument()
  })

  it('every menu link carries the .min-tap class (>=44px tap target, ADR-0018)', () => {
    render(<SiteHeader />)
    const nav = getMobileNav()
    const links = within(nav).getAllByRole('link')
    expect(links.length).toBeGreaterThan(0)
    for (const link of links) {
      expect(link).toHaveClass('min-tap')
    }
  })
})

describe('site-header i18n keys (issue 06)', () => {
  it('en.json: Nav.listYourExperience is removed; wishlist + currencyBadge exist', async () => {
    const { readFileSync } = await import('node:fs')
    const { resolve } = await import('node:path')
    const en = JSON.parse(
      readFileSync(
        resolve(__dirname, '../../../lib/i18n/messages/en.json'),
        'utf-8',
      ),
    ) as { Nav: Record<string, unknown> }
    expect(en.Nav.listYourExperience).toBeUndefined()
    expect(en.Nav.wishlist).toBe('Wishlist')
    expect(en.Nav.currencyBadge).toBe('₹ INR')
  })
})
