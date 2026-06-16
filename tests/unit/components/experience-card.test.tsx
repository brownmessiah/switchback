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

describe('ExperienceCard list layout', () => {
  it('renders the short description in list layout', () => {
    render(
      <ExperienceCard
        layout="list"
        experience={{ ...base, shortDescription: 'A fun flat-water rafting trip' }}
      />,
    )
    expect(screen.getByText('A fun flat-water rafting trip')).toBeTruthy()
  })

  it('does NOT render the short description in the default (grid) layout', () => {
    render(
      <ExperienceCard
        experience={{ ...base, shortDescription: 'A fun flat-water rafting trip' }}
      />,
    )
    expect(screen.queryByText('A fun flat-water rafting trip')).toBeNull()
  })

  it('still links to the experience in list layout', () => {
    const { container } = render(
      <ExperienceCard layout="list" experience={{ ...base }} />,
    )
    expect(container.querySelector('a')?.getAttribute('href')).toBe(
      '/experience/rishikesh-rafting',
    )
  })
})

describe('ExperienceCard trust badges (data-honest, issue 05)', () => {
  // The mocked t() returns the i18n key verbatim, so we assert on the
  // TrustBadges.* label keys produced by deriveTrustBadges → TrustBadge.

  it('renders Flexible cancellation ONLY when the preset is flexible', () => {
    render(
      <ExperienceCard
        experience={{ ...base, cancellationPreset: 'flexible' }}
      />,
    )
    expect(screen.getByText('TrustBadges.flexibleCancellation')).toBeTruthy()
  })

  it('renders NO Flexible cancellation badge for a moderate preset', () => {
    render(
      <ExperienceCard
        experience={{ ...base, cancellationPreset: 'moderate' }}
      />,
    )
    expect(screen.queryByText('TrustBadges.flexibleCancellation')).toBeNull()
  })

  it('renders NO Safety Checked badge when the listing has no safety data', () => {
    render(
      <ExperienceCard
        experience={{ ...base, requiresSafetyStack: false }}
      />,
    )
    expect(screen.queryByText('TrustBadges.safetyChecked')).toBeNull()
  })

  it('renders the Safety Checked badge when requiresSafetyStack is true', () => {
    render(
      <ExperienceCard
        experience={{ ...base, requiresSafetyStack: true }}
      />,
    )
    expect(screen.getByText('TrustBadges.safetyChecked')).toBeTruthy()
  })

  it('renders the tier-specific Verified Vendor label for an identity-verified vendor', () => {
    render(
      <ExperienceCard
        experience={{ ...base, vendorKycTier: 'identity' }}
      />,
    )
    expect(screen.getByText('TrustBadges.verifiedVendor.identity')).toBeTruthy()
  })

  it('renders NO Verified Vendor badge for a phone-only vendor', () => {
    render(
      <ExperienceCard experience={{ ...base, vendorKycTier: 'phone' }} />,
    )
    expect(screen.queryByText('TrustBadges.verifiedVendor.identity')).toBeNull()
    expect(screen.queryByText('TrustBadges.verifiedVendor.business')).toBeNull()
  })

  it('no longer renders any hardcoded freeCancellation badge', () => {
    render(<ExperienceCard experience={base} />)
    // The old unconditional HomePage.trustBadges.freeCancellation badge is gone.
    expect(screen.queryByText('trustBadges.freeCancellation')).toBeNull()
  })
})

describe('ExperienceCard compare toggle (issue 20, D10)', () => {
  it('renders a compare toggle by default', () => {
    render(<ExperienceCard experience={base} />)
    expect(screen.getByTestId('compare-toggle')).toBeTruthy()
  })

  it('omits the compare toggle when showCompare is false', () => {
    render(<ExperienceCard experience={base} showCompare={false} />)
    expect(screen.queryByTestId('compare-toggle')).toBeNull()
  })

  it('keeps the experience link intact alongside the compare toggle', () => {
    const { container } = render(<ExperienceCard experience={base} />)
    // The card's primary anchor is still the experience link (toggle is a
    // sibling overlay, never nested in the anchor).
    expect(container.querySelector('a')?.getAttribute('href')).toBe(
      '/experience/rishikesh-rafting',
    )
  })
})

describe('ExperienceCard "From ₹X" price (issue #08)', () => {
  it('renders "From ₹{lowest}" when a from-price is provided', () => {
    render(
      <ExperienceCard
        experience={{ ...base, pricePerParticipantRupees: 2500, fromPriceRupees: 1800 }}
      />,
    )
    // The mocked t() returns the key 'from' verbatim, followed by the price.
    expect(screen.getByText('from')).toBeTruthy()
    expect(screen.getByText(/1,800/)).toBeTruthy()
  })

  it('shows the variation from-price, NOT the base, when both are present', () => {
    render(
      <ExperienceCard
        experience={{ ...base, pricePerParticipantRupees: 2500, fromPriceRupees: 1800 }}
      />,
    )
    expect(screen.getByText(/1,800/)).toBeTruthy()
    expect(screen.queryByText(/2,500/)).toBeNull()
  })

  it('renders the plain base/bracket price (no "From") when no from-price is set', () => {
    render(
      <ExperienceCard
        experience={{ ...base, pricePerParticipantRupees: 1500 }}
      />,
    )
    // Bracket-only experiences display EXACTLY as before: no "From" prefix.
    expect(screen.queryByText('from')).toBeNull()
    expect(screen.getByText(/1,500/)).toBeTruthy()
    expect(screen.getByText('/ person')).toBeTruthy()
  })

  it('does NOT prefix "From" when the from-price equals the base price', () => {
    // When the lowest active variation is the same as the base, there is no
    // cheaper entry point to advertise — render the plain price.
    render(
      <ExperienceCard
        experience={{ ...base, pricePerParticipantRupees: 1500, fromPriceRupees: 1500 }}
      />,
    )
    expect(screen.queryByText('from')).toBeNull()
    expect(screen.getByText(/1,500/)).toBeTruthy()
  })
})

describe('ExperienceCard bare card (no new data)', () => {
  it('renders no difficulty, social-proof, or rating when none are passed', () => {
    const { container } = render(<ExperienceCard experience={base} />)
    expect(screen.queryByText(/^difficulty\./)).toBeNull()
    expect(screen.queryByText('badges.bestseller')).toBeNull()
    expect(screen.queryByText('badges.topRated')).toBeNull()
    // Price must still be intact.
    expect(screen.getByText('/ person')).toBeTruthy()
    // No stray empty rating number (tabular-nums only appears on price here,
    // which lives in a span without that class — assert no rating star block).
    expect(container.textContent).not.toContain('(0)')
  })
})
