import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * QA fix pass: the footer's "Scuba" discovery link emitted the NON-canonical
 * slug `activity=scuba` — /search filters Meilisearch on `activitySlug` so the
 * link landed on a hard 0-results page and the active-filter chip leaked the
 * raw key "SearchPage.activities.scuba". Every footer activity link must use
 * a canonical slug from lib/activities/registry.
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
import { getActivity } from '@/lib/activities/registry'

afterEach(() => {
  cleanup()
})

beforeEach(() => {
  mockPathname = '/'
})

describe('SiteFooter — discovery links use canonical activity slugs', () => {
  it('every /search?activity= href resolves in the activity registry', () => {
    render(<SiteFooter />)

    const nav = screen.getByRole('navigation', { name: 'Footer navigation' })
    const links = Array.from(nav.querySelectorAll('a[href*="activity="]'))

    expect(links.length).toBeGreaterThan(0)
    for (const link of links) {
      const href = link.getAttribute('href') ?? ''
      const slug = new URLSearchParams(href.split('?')[1] ?? '').get('activity') ?? ''
      expect(getActivity(slug), `non-canonical activity slug "${slug}" in footer href ${href}`).toBeDefined()
    }
  })
})

describe('SiteFooter — no placeholder affordances (QA fix pass)', () => {
  it('renders no dead "#" anchors (empty social icons removed until real accounts exist)', () => {
    const { container } = render(<SiteFooter />)

    const deadAnchors = Array.from(container.querySelectorAll('a[href="#"]'))
    expect(deadAnchors).toHaveLength(0)
  })

  it('renders no "Vendor KYC (soon)" roadmap stub', () => {
    render(<SiteFooter />)

    expect(screen.queryByText('Nav.footer.vendorKyc')).toBeNull()
  })
})
