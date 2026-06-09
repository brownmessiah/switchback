import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { ReviewSection } from '@/components/reviews/review-section'
import type { ReviewSectionProps } from '@/components/reviews/review-section'
import type { EnrichedReview } from '@/lib/reviews/enrichment'

afterEach(() => cleanup())

function review(over: Partial<EnrichedReview>): EnrichedReview {
  return {
    id: 'r1',
    rating: 5,
    title: null,
    body: null,
    customerName: 'Asha',
    createdAt: new Date('2026-01-01T00:00:00Z'),
    status: 'published',
    travelMonth: null,
    groupType: null,
    ...over,
  }
}

const labels: Omit<ReviewSectionProps, 'reviews'> = {
  locale: 'en',
  monthNames: [
    'January',
    'February',
    'March',
    'April',
    'May',
    'June',
    'July',
    'August',
    'September',
    'October',
    'November',
    'December',
  ],
  travelledInLabel: 'Travelled in {month}',
  verifiedLabel: 'Verified booking',
  groupTypeLabels: {
    solo: 'Solo',
    couple: 'Couple',
    friends: 'Friends',
    family: 'Family',
    corporate: 'Corporate',
  },
  sortLabel: 'Sort',
  sortLabels: {
    recent: 'Most recent',
    highest: 'Highest rated',
    lowest: 'Lowest rated',
  },
  emptyLabel: 'No reviews yet.',
  summaryLabel: '{avg} out of 5 ({count} reviews)',
}

describe('ReviewSection', () => {
  it('shows travel month, group type and a verified-booking badge per review', () => {
    render(
      <ReviewSection
        reviews={[
          review({
            id: 'a',
            travelMonth: 6,
            groupType: 'family',
            customerName: 'Asha',
          }),
        ]}
        {...labels}
      />,
    )
    expect(screen.getByText('Travelled in June')).toBeTruthy()
    expect(screen.getByText('Family')).toBeTruthy()
    expect(screen.getByText('Verified booking')).toBeTruthy()
  })

  it('omits travel month and group type when null', () => {
    render(<ReviewSection reviews={[review({ id: 'a' })]} {...labels} />)
    expect(screen.queryByText(/Travelled in/)).toBeNull()
    expect(screen.queryByText('Family')).toBeNull()
    // Verified badge still renders — every review is booking-backed.
    expect(screen.getByText('Verified booking')).toBeTruthy()
  })

  it('renders newest-first by default and reorders by highest / lowest', () => {
    const reviews = [
      review({
        id: 'low',
        rating: 1,
        title: 'low',
        createdAt: new Date('2026-06-01T00:00:00Z'),
      }),
      review({
        id: 'high',
        rating: 5,
        title: 'high',
        createdAt: new Date('2026-01-01T00:00:00Z'),
      }),
    ]
    render(<ReviewSection reviews={reviews} {...labels} />)

    const titlesInOrder = () =>
      screen
        .getAllByTestId('review-item')
        .map((el) => within(el).getByTestId('review-title').textContent)

    // recent (default): low (June) before high (January)
    expect(titlesInOrder()).toEqual(['low', 'high'])

    fireEvent.click(screen.getByTestId('review-sort-highest'))
    expect(titlesInOrder()).toEqual(['high', 'low'])

    fireEvent.click(screen.getByTestId('review-sort-lowest'))
    expect(titlesInOrder()).toEqual(['low', 'high'])

    fireEvent.click(screen.getByTestId('review-sort-recent'))
    expect(titlesInOrder()).toEqual(['low', 'high'])
  })

  it('renders an empty state with no reviews', () => {
    render(<ReviewSection reviews={[]} {...labels} />)
    expect(screen.getByText('No reviews yet.')).toBeTruthy()
    expect(screen.queryByTestId('review-sort-highest')).toBeNull()
  })
})
