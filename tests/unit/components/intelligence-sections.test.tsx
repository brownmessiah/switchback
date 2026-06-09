import { cleanup, render, screen } from '@testing-library/react'
import type { ComponentProps } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  ActivityIntelligenceSections,
  RegionIntelligenceSections,
  type ActivityIntelligenceLabels,
  type RegionIntelligenceLabels,
} from '@/components/content/intelligence-sections'
import type {
  ActivityIntelligence,
  RegionIntelligence,
} from '@/lib/content/intelligence'

// ExperienceCard (rendered inside the featured section) needs only a string t().
vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
}))
vi.mock('next/image', () => ({
  default: (props: ComponentProps<'img'> & { fill?: boolean }) => {
    const { src, alt } = props
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={typeof src === 'string' ? src : ''} alt={alt} />
  },
}))

afterEach(() => cleanup())

const regionLabels: RegionIntelligenceLabels = {
  priceRangeHeading: 'Price range',
  priceRangeValue: ({ minRupees, maxRupees }) => `From ₹${minRupees} to ₹${maxRupees}`,
  topActivitiesHeading: 'Top activities',
  nearbyHeading: 'Nearby destinations',
  difficultyHeading: 'Difficulty',
  featuredHeading: 'Featured experiences',
  difficultyLabel: (d) => d,
  countChip: (label, count) => `${label} (${count})`,
  activityName: (s) => s,
  regionName: (s) => s,
}

const activityLabels: ActivityIntelligenceLabels = {
  ...regionLabels,
  topDestinationsHeading: 'Top destinations',
}

const fullRegion: RegionIntelligence = {
  priceRange: { minRupees: 1500, maxRupees: 4500 },
  topActivities: [{ slug: 'rafting', count: 2 }],
  nearbyRegions: [{ slug: 'auli', count: 1 }],
  difficultySpread: [{ difficulty: 'moderate', count: 1 }],
  featured: [],
}

const emptyRegion: RegionIntelligence = {
  priceRange: null,
  topActivities: [],
  nearbyRegions: [],
  difficultySpread: [],
  featured: [],
}

describe('RegionIntelligenceSections', () => {
  it('renders price range, top activities, nearby and difficulty when present', () => {
    render(<RegionIntelligenceSections data={fullRegion} labels={regionLabels} />)
    expect(screen.getByText('Price range')).toBeTruthy()
    expect(screen.getByText('From ₹1500 to ₹4500')).toBeTruthy()
    expect(screen.getByText('Top activities')).toBeTruthy()
    expect(screen.getByText('rafting (2)')).toBeTruthy()
    expect(screen.getByText('Nearby destinations')).toBeTruthy()
    expect(screen.getByText('auli (1)')).toBeTruthy()
    expect(screen.getByText('Difficulty')).toBeTruthy()
    expect(screen.getByText('moderate (1)')).toBeTruthy()
  })

  it('links top activities to /activities and nearby to /destinations', () => {
    const { container } = render(
      <RegionIntelligenceSections data={fullRegion} labels={regionLabels} />,
    )
    const hrefs = Array.from(container.querySelectorAll('a')).map((a) =>
      a.getAttribute('href'),
    )
    expect(hrefs).toContain('/activities/rafting')
    expect(hrefs).toContain('/destinations/auli')
  })

  it('renders NOTHING when the region has no derived data (empty-safe)', () => {
    const { container } = render(
      <RegionIntelligenceSections data={emptyRegion} labels={regionLabels} />,
    )
    expect(container.querySelector('section')).toBeNull()
    expect(container.textContent).toBe('')
  })

  it('hides only the empty sections, keeping the populated ones', () => {
    const partial: RegionIntelligence = {
      ...emptyRegion,
      priceRange: { minRupees: 1000, maxRupees: 2000 },
    }
    render(<RegionIntelligenceSections data={partial} labels={regionLabels} />)
    expect(screen.getByText('Price range')).toBeTruthy()
    expect(screen.queryByText('Top activities')).toBeNull()
    expect(screen.queryByText('Nearby destinations')).toBeNull()
    expect(screen.queryByText('Difficulty')).toBeNull()
  })
})

describe('ActivityIntelligenceSections', () => {
  const fullActivity: ActivityIntelligence = {
    priceRange: { minRupees: 1500, maxRupees: 4500 },
    topRegions: [{ slug: 'rishikesh', count: 2 }],
    difficultySpread: [{ difficulty: 'challenging', count: 1 }],
    featured: [],
  }

  it('renders price range + top destinations + difficulty when present', () => {
    const { container } = render(
      <ActivityIntelligenceSections data={fullActivity} labels={activityLabels} />,
    )
    expect(screen.getByText('Top destinations')).toBeTruthy()
    expect(screen.getByText('rishikesh (2)')).toBeTruthy()
    const hrefs = Array.from(container.querySelectorAll('a')).map((a) =>
      a.getAttribute('href'),
    )
    expect(hrefs).toContain('/destinations/rishikesh')
  })

  it('renders NOTHING when the activity has no derived data (empty-safe)', () => {
    const empty: ActivityIntelligence = {
      priceRange: null,
      topRegions: [],
      difficultySpread: [],
      featured: [],
    }
    const { container } = render(
      <ActivityIntelligenceSections data={empty} labels={activityLabels} />,
    )
    expect(container.textContent).toBe('')
  })
})
