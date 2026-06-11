import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import {
  SearchEmptyState,
  type SearchEmptyAlternative,
} from '@/components/search/search-empty-state'

const labels = {
  title: 'No experiences found',
  hint: 'Try adjusting your filters or search for something else.',
  clearFilters: 'Clear filters',
  alternativesLabel: 'Popular searches',
  browseDestinations: 'Browse nearby destinations',
}

const alternatives: SearchEmptyAlternative[] = [
  { key: 'rishikesh:rafting', href: '/search?region=rishikesh&activity=rafting', label: 'Rishikesh Rafting' },
  { key: 'goa:scuba-diving', href: '/search?region=goa&activity=scuba-diving', label: 'Goa Scuba diving' },
]

afterEach(() => cleanup())

describe('SearchEmptyState', () => {
  it('renders the empty-state heading and hint inside the shared EmptyState shell', () => {
    render(<SearchEmptyState labels={labels} isFiltered alternatives={alternatives} />)
    const root = screen.getByTestId('search-empty')
    expect(root).toBeInTheDocument()
    expect(screen.getByText('No experiences found')).toBeInTheDocument()
    expect(
      screen.getByText('Try adjusting your filters or search for something else.'),
    ).toBeInTheDocument()
  })

  it('offers a "Clear filters" link to bare /search when the search is filtered', () => {
    render(<SearchEmptyState labels={labels} isFiltered alternatives={alternatives} />)
    const clear = screen.getByRole('link', { name: 'Clear filters' })
    expect(clear).toHaveAttribute('href', '/search')
  })

  it('does NOT render a Clear filters link when the search is not filtered', () => {
    render(<SearchEmptyState labels={labels} isFiltered={false} alternatives={alternatives} />)
    expect(screen.queryByRole('link', { name: 'Clear filters' })).toBeNull()
  })

  it('renders the inventory-backed popular alternatives as deep links', () => {
    render(<SearchEmptyState labels={labels} isFiltered alternatives={alternatives} />)
    const rishikesh = screen.getByRole('link', { name: 'Rishikesh Rafting' })
    expect(rishikesh).toHaveAttribute('href', '/search?region=rishikesh&activity=rafting')
    const goa = screen.getByRole('link', { name: 'Goa Scuba diving' })
    expect(goa).toHaveAttribute('href', '/search?region=goa&activity=scuba-diving')
  })

  it('omits the alternatives block entirely when there is no live inventory', () => {
    render(<SearchEmptyState labels={labels} isFiltered alternatives={[]} />)
    expect(screen.queryByText('Popular searches')).toBeNull()
  })

  // QA fix pass: the empty state always offers a destinations browse path —
  // even with zero live alternatives — so a dead-end search has a way out.
  it('offers a "Browse nearby destinations" link to /destinations', () => {
    render(<SearchEmptyState labels={labels} isFiltered alternatives={[]} />)
    const browse = screen.getByRole('link', { name: 'Browse nearby destinations' })
    expect(browse).toHaveAttribute('href', '/destinations')
  })
})
