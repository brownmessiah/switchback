import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { DashboardBookingsEmpty } from '@/components/dashboard-bookings-empty'

const labels = {
  title: 'No bookings yet',
  hint: 'Your booked Experiences will show up here.',
  cta: 'Explore Experiences',
}

afterEach(() => cleanup())

describe('DashboardBookingsEmpty', () => {
  it('renders the "no bookings yet" copy via the shared EmptyState', () => {
    render(<DashboardBookingsEmpty labels={labels} />)
    expect(screen.getByTestId('bookings-empty')).toBeInTheDocument()
    expect(screen.getByText('No bookings yet')).toBeInTheDocument()
    expect(screen.getByText('Your booked Experiences will show up here.')).toBeInTheDocument()
  })

  it('CTA links to /search (NOT a hardcoded /en/search locale prefix)', () => {
    render(<DashboardBookingsEmpty labels={labels} />)
    const cta = screen.getByRole('link', { name: 'Explore Experiences' })
    expect(cta).toHaveAttribute('href', '/search')
    expect(cta.getAttribute('href')).not.toContain('/en/')
  })
})
