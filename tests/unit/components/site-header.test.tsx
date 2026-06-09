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

function getPrimaryNav(): HTMLElement {
  return screen.getByRole('navigation', { name: 'Primary' })
}

describe('SiteHeader — discovery-forward primary nav (issue 03)', () => {
  it('renders exactly the five discovery items with correct hrefs', () => {
    render(<SiteHeader />)
    const nav = getPrimaryNav()

    const explore = within(nav).getByRole('link', { name: 'explore' })
    expect(explore).toHaveAttribute('href', '/search')

    expect(within(nav).getByRole('link', { name: 'destinations' })).toHaveAttribute(
      'href',
      '/destinations',
    )
    // Activities lands on the canonical search grid (no /activities index route).
    expect(within(nav).getByRole('link', { name: 'activities' })).toHaveAttribute(
      'href',
      '/search',
    )
    expect(within(nav).getByRole('link', { name: 'safety' })).toHaveAttribute(
      'href',
      '/safety',
    )
    expect(within(nav).getByRole('link', { name: 'blog' })).toHaveAttribute(
      'href',
      '/blog',
    )
  })

  it('does NOT render a "Community" primary item or an /community link', () => {
    render(<SiteHeader />)
    const nav = getPrimaryNav()
    expect(within(nav).queryByRole('link', { name: 'community' })).not.toBeInTheDocument()
    expect(
      within(nav).queryByRole('link', { name: /community/i }),
    ).not.toBeInTheDocument()
  })

  it('does NOT render the old "Experiences" primary label', () => {
    render(<SiteHeader />)
    const nav = getPrimaryNav()
    expect(
      within(nav).queryByRole('link', { name: 'experiences' }),
    ).not.toBeInTheDocument()
  })

  it('renders a right-side "List your experience" CTA → /vendor-partner (issue 06)', () => {
    render(<SiteHeader />)
    const nav = getPrimaryNav()
    expect(
      within(nav).getByRole('link', { name: 'listYourExperience' }),
    ).toHaveAttribute('href', '/vendor-partner')
  })

  it('keeps the AuthStatus (Sign in) control on the desktop bar', () => {
    render(<SiteHeader />)
    expect(screen.getByTestId('auth-status')).toBeInTheDocument()
  })

  it('returns null inside the back-office (e.g. /admin)', () => {
    mockPathname = '/admin/dashboard'
    const { container } = render(<SiteHeader />)
    expect(container).toBeEmptyDOMElement()
  })
})

describe('SiteHeader — mobile drawer mirrors the discovery nav (issue 03)', () => {
  function getMobileNav(): HTMLElement {
    return screen.getByRole('navigation', { name: 'Mobile primary' })
  }

  it('mirrors the five discovery items with the same hrefs', () => {
    render(<SiteHeader />)
    const nav = getMobileNav()

    expect(within(nav).getByRole('link', { name: 'explore' })).toHaveAttribute(
      'href',
      '/search',
    )
    expect(within(nav).getByRole('link', { name: 'destinations' })).toHaveAttribute(
      'href',
      '/destinations',
    )
    expect(within(nav).getByRole('link', { name: 'activities' })).toHaveAttribute(
      'href',
      '/search',
    )
    expect(within(nav).getByRole('link', { name: 'safety' })).toHaveAttribute(
      'href',
      '/safety',
    )
    expect(within(nav).getByRole('link', { name: 'blog' })).toHaveAttribute(
      'href',
      '/blog',
    )
  })

  it('mirrors the right-side CTAs: List your experience (→ /vendor-partner) + Sign in', () => {
    render(<SiteHeader />)
    const nav = getMobileNav()
    expect(
      within(nav).getByRole('link', { name: 'listYourExperience' }),
    ).toHaveAttribute('href', '/vendor-partner')
    expect(within(nav).getByRole('link', { name: 'signIn' })).toHaveAttribute(
      'href',
      '/sign-in',
    )
  })

  it('has no "Community" item in the mobile drawer', () => {
    render(<SiteHeader />)
    const nav = getMobileNav()
    expect(
      within(nav).queryByRole('link', { name: /community/i }),
    ).not.toBeInTheDocument()
  })

  it('every drawer link carries the .min-tap class (>=44px tap target, ADR-0018)', () => {
    render(<SiteHeader />)
    const nav = getMobileNav()
    const links = within(nav).getAllByRole('link')
    expect(links.length).toBeGreaterThan(0)
    for (const link of links) {
      expect(link).toHaveClass('min-tap')
    }
  })
})
