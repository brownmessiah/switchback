import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { VendorTableTabs } from './vendor-table-tabs'

afterEach(cleanup)

/**
 * The shared tri-tab shell (#80/#81/#82, archetype #54 direction B wrapped in
 * A's tri-tab shell). The SAME nav renders on /vendor/bookings, /vendor/payouts
 * and /vendor/reviews — each a SEPARATE route — with the current route as the
 * active tab. It links between the three; it never merges them into one route.
 */
describe('VendorTableTabs (shared tri-tab shell)', () => {
  it('renders a link to each of the three master-table routes', () => {
    render(<VendorTableTabs active="bookings" />)

    const nav = screen.getByTestId('vendor-table-tabs')
    expect(nav).toBeInTheDocument()

    const bookings = screen.getByRole('link', { name: /bookings/i })
    const payouts = screen.getByRole('link', { name: /payouts/i })
    const reviews = screen.getByRole('link', { name: /reviews/i })

    expect(bookings).toHaveAttribute('href', '/vendor/bookings')
    expect(payouts).toHaveAttribute('href', '/vendor/payouts')
    expect(reviews).toHaveAttribute('href', '/vendor/reviews')
  })

  it('marks the active route with aria-current="page"', () => {
    render(<VendorTableTabs active="payouts" />)

    expect(screen.getByRole('link', { name: /payouts/i })).toHaveAttribute(
      'aria-current',
      'page',
    )
    expect(screen.getByRole('link', { name: /bookings/i })).not.toHaveAttribute(
      'aria-current',
    )
    expect(screen.getByRole('link', { name: /reviews/i })).not.toHaveAttribute(
      'aria-current',
    )
  })
})
