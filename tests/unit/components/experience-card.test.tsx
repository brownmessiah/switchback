import { cleanup, render } from '@testing-library/react'
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
