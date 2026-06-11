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
 * Minimal header contract (owner screenshots, 2026-06-11 — Headout-style):
 * ONLY the wordmark, the supply-side "List your experience" CTA, the locale/
 * theme utilities, and the auth control. The five discovery links (Explore /
 * Destinations / Activities / Safety / Blog) moved out of the header — they
 * live in the footer's "Explore" + "Support" columns sitewide. This
 * supersedes the issue-03 discovery-forward bar.
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

describe('SiteHeader — minimal Headout-style bar (screenshots 2026-06-11)', () => {
  it('renders the wordmark linking home', () => {
    render(<SiteHeader />)
    expect(screen.getByRole('link', { name: 'homeAriaLabel' })).toHaveAttribute(
      'href',
      '/',
    )
  })

  it('renders NO discovery links in the header at all', () => {
    render(<SiteHeader />)
    for (const key of REMOVED_DISCOVERY_KEYS) {
      expect(
        screen.queryByRole('link', { name: key }),
      ).not.toBeInTheDocument()
    }
  })

  it('renders the "List your experience" CTA → /vendor-partner on the desktop bar', () => {
    render(<SiteHeader />)
    const nav = screen.getByRole('navigation', { name: 'Primary' })
    expect(
      within(nav).getByRole('link', { name: 'listYourExperience' }),
    ).toHaveAttribute('href', '/vendor-partner')
  })

  it('keeps the utilities: theme toggle, language selector, AuthStatus (Sign in)', () => {
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

describe('SiteHeader — mobile menu mirrors the minimal bar', () => {
  function getMobileNav(): HTMLElement {
    return screen.getByRole('navigation', { name: 'Mobile primary' })
  }

  it('carries ONLY List your experience + Sign in (no discovery links)', () => {
    render(<SiteHeader />)
    const nav = getMobileNav()
    expect(
      within(nav).getByRole('link', { name: 'listYourExperience' }),
    ).toHaveAttribute('href', '/vendor-partner')
    expect(within(nav).getByRole('link', { name: 'signIn' })).toHaveAttribute(
      'href',
      '/sign-in',
    )
    for (const key of REMOVED_DISCOVERY_KEYS) {
      expect(
        within(nav).queryByRole('link', { name: key }),
      ).not.toBeInTheDocument()
    }
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
