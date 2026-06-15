/**
 * Tests for the Vendor dashboard quick-action cards (#04).
 *
 * The row is a small wayfinding affordance: one reusable card (icon + label +
 * chevron) repeated for the four highest-frequency Vendor surfaces. Asserts:
 *   - exactly four cards render, each a link to the correct EXISTING route,
 *   - labels come from VendorQuickActions (translated, en + hi),
 *   - "Manage Availability" routes to the Experiences list (/vendor/listings),
 *     NOT a non-existent /vendor/availability,
 *   - each card carries a trailing chevron and decorative (aria-hidden) icons
 *     so the accessible name is the visible text label (axe / WCAG 1.1.1).
 */

import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import enMessages from '@/lib/i18n/messages/en.json'
import hiMessages from '@/lib/i18n/messages/hi.json'

import { VendorQuickActions } from './quick-actions'

function renderWithIntl(
  ui: React.ReactElement,
  { locale, messages }: { locale: string; messages: Record<string, unknown> },
) {
  const { NextIntlClientProvider } = require('next-intl')
  return render(
    <NextIntlClientProvider locale={locale} messages={messages}>
      {ui}
    </NextIntlClientProvider>,
  )
}

afterEach(() => {
  cleanup()
})

/** The four wayfinding targets, keyed to the real existing Vendor routes. */
const EXPECTED_CARDS: ReadonlyArray<{ href: string; en: string; hi: string }> = [
  { href: '/vendor/listings/new', en: 'Add Experience', hi: 'अनुभव जोड़ें' },
  { href: '/vendor/bookings', en: 'View Bookings', hi: 'बुकिंग देखें' },
  // Availability is set per-Experience — the card routes to the Experiences list.
  { href: '/vendor/listings', en: 'Manage Availability', hi: 'उपलब्धता प्रबंधित करें' },
  { href: '/vendor/payouts', en: 'View Earnings', hi: 'कमाई देखें' },
]

describe('VendorQuickActions', () => {
  it('renders exactly four quick-action cards', () => {
    renderWithIntl(<VendorQuickActions />, { locale: 'en', messages: enMessages })

    const links = screen.getAllByRole('link')
    expect(links).toHaveLength(4)
  })

  it('routes each card to the correct existing Vendor surface with its English label', () => {
    renderWithIntl(<VendorQuickActions />, { locale: 'en', messages: enMessages })

    for (const card of EXPECTED_CARDS) {
      const link = screen.getByRole('link', { name: new RegExp(card.en, 'i') })
      expect(link).toHaveAttribute('href', card.href)
    }
  })

  it('links "Manage Availability" to the Experiences list, not /vendor/availability', () => {
    renderWithIntl(<VendorQuickActions />, { locale: 'en', messages: enMessages })

    const link = screen.getByRole('link', { name: /Manage Availability/i })
    expect(link).toHaveAttribute('href', '/vendor/listings')
    expect(link).not.toHaveAttribute('href', '/vendor/availability')
  })

  it('renders translated labels in Hindi', () => {
    renderWithIntl(<VendorQuickActions />, { locale: 'hi', messages: hiMessages })

    for (const card of EXPECTED_CARDS) {
      const link = screen.getByRole('link', { name: new RegExp(card.hi) })
      expect(link).toHaveAttribute('href', card.href)
    }
  })

  it('renders the translated section heading', () => {
    renderWithIntl(<VendorQuickActions />, { locale: 'en', messages: enMessages })
    expect(screen.getByText('Quick actions')).toBeInTheDocument()
  })

  it('marks every card icon as decorative (aria-hidden) so the label is the accessible name', () => {
    const { container } = renderWithIntl(<VendorQuickActions />, {
      locale: 'en',
      messages: enMessages,
    })

    const links = screen.getAllByRole('link')
    for (const link of links) {
      // Each card carries a leading action icon AND a trailing chevron — both
      // decorative. svg icons must be aria-hidden so axe sees no unnamed graphic.
      const svgs = link.querySelectorAll('svg')
      expect(svgs.length).toBeGreaterThanOrEqual(2)
      for (const svg of svgs) {
        expect(svg).toHaveAttribute('aria-hidden', 'true')
      }
    }
  })

  it('renders a trailing chevron affordance on every card', () => {
    renderWithIntl(<VendorQuickActions />, { locale: 'en', messages: enMessages })

    // The chevron carries data-testid="quick-action-chevron" so the affordance
    // is assertable without coupling to the lucide class names.
    const links = screen.getAllByRole('link')
    for (const link of links) {
      const chevron = within(link).getByTestId('quick-action-chevron')
      expect(chevron).toBeInTheDocument()
      expect(chevron).toHaveAttribute('aria-hidden', 'true')
    }
  })
})
