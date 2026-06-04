import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ComponentProps } from 'react'

import { ExperienceCard, type ExperienceCardData } from '@/components/experience-card'
import { getActivityImage } from '@/lib/images'

// next-intl: the card only needs t() to return a string.
vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
}))

// next/image: passthrough so we can assert the exact resolved src.
vi.mock('next/image', () => ({
  default: (props: ComponentProps<'img'> & { fill?: boolean }) => {
    const { src, alt } = props
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={typeof src === 'string' ? src : ''} alt={alt} />
  },
}))

afterEach(() => {
  cleanup()
})

const base: ExperienceCardData = {
  id: 'e1',
  slug: 'rishikesh-rafting',
  title: 'Rafting',
  pricePerParticipantRupees: 1500,
  regionSlug: 'rishikesh',
  activitySlug: 'rafting',
}

describe('ExperienceCard image source', () => {
  it('renders the real per-listing cover image when coverImageUrl is provided', () => {
    const { container } = render(
      <ExperienceCard experience={{ ...base, coverImageUrl: 'https://cdn.example.com/real-cover.jpg' }} />,
    )
    expect(container.querySelector('img')?.getAttribute('src')).toBe(
      'https://cdn.example.com/real-cover.jpg',
    )
  })

  it('falls back to the activity stock image when no coverImageUrl', () => {
    const { container } = render(<ExperienceCard experience={base} />)
    expect(container.querySelector('img')?.getAttribute('src')).toBe(getActivityImage('rafting'))
  })
})

// The mocked t() returns the i18n KEY verbatim, so we assert on the keys.
describe('ExperienceCard difficulty badge', () => {
  it('renders the difficulty label only when difficulty is set', () => {
    render(<ExperienceCard experience={{ ...base, difficulty: 'moderate' }} />)
    expect(screen.getByText('difficulty.moderate')).toBeTruthy()
  })

  it('renders the correct label for each difficulty level', () => {
    const levels = ['easy', 'moderate', 'challenging', 'extreme'] as const
    for (const level of levels) {
      const { unmount } = render(
        <ExperienceCard experience={{ ...base, difficulty: level }} />,
      )
      expect(screen.getByText(`difficulty.${level}`)).toBeTruthy()
      unmount()
    }
  })

  it('renders NO difficulty badge when difficulty is absent or null', () => {
    render(<ExperienceCard experience={{ ...base, difficulty: null }} />)
    expect(screen.queryByText(/^difficulty\./)).toBeNull()
  })
})

describe('ExperienceCard social-proof badge', () => {
  it('renders the Bestseller badge only when highlight=bestseller', () => {
    render(<ExperienceCard experience={{ ...base, highlight: 'bestseller' }} />)
    expect(screen.getByText('badges.bestseller')).toBeTruthy()
    expect(screen.queryByText('badges.topRated')).toBeNull()
  })

  it('renders the Top rated badge only when highlight=top_rated', () => {
    render(<ExperienceCard experience={{ ...base, highlight: 'top_rated' }} />)
    expect(screen.getByText('badges.topRated')).toBeTruthy()
    expect(screen.queryByText('badges.bestseller')).toBeNull()
  })

  it('renders NO social-proof badge when highlight is absent or null', () => {
    render(<ExperienceCard experience={{ ...base, highlight: null }} />)
    expect(screen.queryByText('badges.bestseller')).toBeNull()
    expect(screen.queryByText('badges.topRated')).toBeNull()
  })
})

describe('ExperienceCard rating', () => {
  it('renders "★ avg (count)" only when ratingCount > 0', () => {
    render(
      <ExperienceCard
        experience={{ ...base, ratingAvg: 4.7, ratingCount: 12 }}
      />,
    )
    expect(screen.getByText('4.7')).toBeTruthy()
    expect(screen.getByText('(12)')).toBeTruthy()
  })

  it('does not render the rating when ratingCount is 0 or absent', () => {
    render(
      <ExperienceCard experience={{ ...base, ratingAvg: 5, ratingCount: 0 }} />,
    )
    // No "(count)" block and no avg rendered.
    expect(screen.queryByText('(0)')).toBeNull()
    expect(screen.queryByText('5.0')).toBeNull()
  })
})

describe('ExperienceCard bare card (no new data)', () => {
  it('renders no difficulty, social-proof, or rating when none are passed', () => {
    const { container } = render(<ExperienceCard experience={base} />)
    expect(screen.queryByText(/^difficulty\./)).toBeNull()
    expect(screen.queryByText('badges.bestseller')).toBeNull()
    expect(screen.queryByText('badges.topRated')).toBeNull()
    // Price + free-cancellation must still be intact.
    expect(screen.getByText('/ person')).toBeTruthy()
    expect(screen.getByText('trustBadges.freeCancellation')).toBeTruthy()
    // No stray empty rating number (tabular-nums only appears on price here,
    // which lives in a span without that class — assert no rating star block).
    expect(container.textContent).not.toContain('(0)')
  })
})
