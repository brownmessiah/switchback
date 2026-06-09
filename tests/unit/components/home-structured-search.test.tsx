import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

/**
 * Issue 09 — Home hero structured 4-field search.
 *
 * The component replaces the single keyword field with Destination / Activity /
 * Date / Group size, and on submit navigates to the EXISTING `/search` with the
 * right facets (via `lib/search/home-query`). It also exposes a mobile
 * full-screen overlay (ADR-0018 large touch targets).
 *
 * Translation keys are returned verbatim by the mock, so assertions are by
 * stable i18n key, never translated copy. `next/navigation` is mocked so we can
 * assert the exact URL the form pushes.
 */

const mockPush = vi.fn()

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
}))

vi.mock('next-intl', () => ({
  useTranslations:
    (ns: string) =>
    (key: string) =>
      ns ? `${ns}.${key}` : key,
}))

import { HomeStructuredSearch } from '@/components/home/structured-search'

const OPTIONS = {
  destinations: [
    { slug: 'rishikesh', i18nKey: 'rishikesh', nameEn: 'Rishikesh' },
    { slug: 'goa', i18nKey: 'goa', nameEn: 'Goa' },
  ],
  activities: [
    { slug: 'rafting', i18nKey: 'rafting', nameEn: 'Rafting' },
    { slug: 'scuba-diving', i18nKey: 'scubaDiving', nameEn: 'Scuba Diving' },
  ],
}

afterEach(() => {
  cleanup()
  mockPush.mockClear()
})

describe('HomeStructuredSearch', () => {
  it('renders the four structured fields (destination, activity, date, group size)', () => {
    render(<HomeStructuredSearch destinations={OPTIONS.destinations} activities={OPTIONS.activities} />)
    const form = screen.getByTestId('home-search-form')
    expect(within(form).getByTestId('home-search-destination')).toBeInTheDocument()
    expect(within(form).getByTestId('home-search-activity')).toBeInTheDocument()
    expect(within(form).getByTestId('home-search-date')).toBeInTheDocument()
    expect(within(form).getByTestId('home-search-groupSize')).toBeInTheDocument()
  })

  it('navigates to /search with the mapped facets on submit', () => {
    render(<HomeStructuredSearch destinations={OPTIONS.destinations} activities={OPTIONS.activities} />)
    const form = screen.getByTestId('home-search-form')

    fireEvent.change(within(form).getByTestId('home-search-destination'), {
      target: { value: 'rishikesh' },
    })
    fireEvent.change(within(form).getByTestId('home-search-activity'), {
      target: { value: 'rafting' },
    })
    fireEvent.change(within(form).getByTestId('home-search-date'), {
      target: { value: '2026-06-15' },
    })
    fireEvent.change(within(form).getByTestId('home-search-groupSize'), {
      target: { value: '4' },
    })
    fireEvent.submit(form)

    expect(mockPush).toHaveBeenCalledWith(
      '/search?region=rishikesh&activity=rafting&season=6&groupSize=4',
    )
  })

  it('submits to bare /search when no field is filled (omits empty facets)', () => {
    render(<HomeStructuredSearch destinations={OPTIONS.destinations} activities={OPTIONS.activities} />)
    fireEvent.submit(screen.getByTestId('home-search-form'))
    expect(mockPush).toHaveBeenCalledWith('/search')
  })

  it('exposes a mobile overlay trigger that opens a full-screen dialog', () => {
    render(<HomeStructuredSearch destinations={OPTIONS.destinations} activities={OPTIONS.activities} />)
    const trigger = screen.getByTestId('home-search-mobile-trigger')
    expect(trigger).toBeInTheDocument()
    // Closed initially.
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    fireEvent.click(trigger)
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })
})
