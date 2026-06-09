import { cleanup, render, screen, waitFor } from '@testing-library/react'
import type { ComponentProps } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { ExperienceCardData } from '@/components/experience-card'
import { RecentlyViewedRail } from '@/components/recently-viewed/rail'
import { RecentlyViewedRecorder } from '@/components/recently-viewed/recorder'
import {
  RECENTLY_VIEWED_STORAGE_KEY,
  getRecentSlugs,
} from '@/lib/recently-viewed/storage'

// next-intl: t() returns the key so we assert on the heading key.
vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
}))

// next/image passthrough so the card renders in jsdom.
vi.mock('next/image', () => ({
  default: (props: ComponentProps<'img'> & { fill?: boolean }) => {
    const { src, alt } = props
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={typeof src === 'string' ? src : ''} alt={alt ?? ''} />
  },
}))

function card(slug: string, title: string): ExperienceCardData {
  return {
    id: slug,
    slug,
    title,
    pricePerParticipantRupees: 1500,
    regionSlug: 'rishikesh',
    activitySlug: 'rafting',
  }
}

afterEach(() => {
  cleanup()
  window.localStorage.clear()
})

beforeEach(() => {
  window.localStorage.clear()
})

describe('RecentlyViewedRecorder', () => {
  it('records the slug into localStorage on mount', () => {
    render(<RecentlyViewedRecorder slug="rafting-rishikesh" />)
    expect(getRecentSlugs()).toEqual(['rafting-rishikesh'])
  })

  it('moves a re-viewed slug to the front (dedupe via storage core)', () => {
    window.localStorage.setItem(
      RECENTLY_VIEWED_STORAGE_KEY,
      JSON.stringify(['b', 'rafting-rishikesh']),
    )
    render(<RecentlyViewedRecorder slug="rafting-rishikesh" />)
    expect(getRecentSlugs()).toEqual(['rafting-rishikesh', 'b'])
  })

  it('renders nothing visible', () => {
    const { container } = render(<RecentlyViewedRecorder slug="x" />)
    expect(container.textContent).toBe('')
  })
})

describe('RecentlyViewedRail', () => {
  it('renders nothing when there are no stored slugs (hidden when empty)', async () => {
    const fetchCards = vi.fn(async () => [] as ExperienceCardData[])
    const { container } = render(<RecentlyViewedRail fetchCards={fetchCards} />)
    // No stored slugs → the fetcher is never called and nothing renders.
    await waitFor(() => {
      expect(container.querySelector('section')).toBeNull()
    })
    expect(fetchCards).not.toHaveBeenCalled()
  })

  it('renders nothing when stored slugs resolve to no visible cards', async () => {
    window.localStorage.setItem(
      RECENTLY_VIEWED_STORAGE_KEY,
      JSON.stringify(['stale-draft']),
    )
    // The (gated) fetcher returns [] — e.g. the only stored slug is now draft.
    const fetchCards = vi.fn(async () => [] as ExperienceCardData[])
    const { container } = render(<RecentlyViewedRail fetchCards={fetchCards} />)
    await waitFor(() => {
      expect(fetchCards).toHaveBeenCalledWith(['stale-draft'])
    })
    await waitFor(() => {
      expect(container.querySelector('section')).toBeNull()
    })
  })

  it('renders the cards returned by the gated fetcher, newest-first', async () => {
    window.localStorage.setItem(
      RECENTLY_VIEWED_STORAGE_KEY,
      JSON.stringify(['c', 'b', 'a']),
    )
    // The loader gates + preserves recency order; the rail renders them as-is.
    const fetchCards = vi.fn(async (slugs: string[]) => {
      expect(slugs).toEqual(['c', 'b', 'a'])
      return [card('c', 'Card C'), card('b', 'Card B'), card('a', 'Card A')]
    })
    render(<RecentlyViewedRail fetchCards={fetchCards} />)

    await waitFor(() => {
      expect(screen.getByText('Card C')).toBeTruthy()
    })
    const titles = screen
      .getAllByRole('heading', { level: 3 })
      .map((h) => h.textContent)
    expect(titles).toEqual(['Card C', 'Card B', 'Card A'])
    // Heading uses the i18n key (mocked t returns the key).
    expect(screen.getByText('heading')).toBeTruthy()
  })

  it('does not render unpublished/fixture cards — it only renders what the gated fetcher returns', async () => {
    window.localStorage.setItem(
      RECENTLY_VIEWED_STORAGE_KEY,
      JSON.stringify(['fixture-x', 'pub']),
    )
    // The fetcher (lib/recently-viewed/loader) already dropped the fixture; the
    // rail must render ONLY the returned (gated) card.
    const fetchCards = vi.fn(async () => [card('pub', 'Published One')])
    render(<RecentlyViewedRail fetchCards={fetchCards} />)
    await waitFor(() => {
      expect(screen.getByText('Published One')).toBeTruthy()
    })
    expect(screen.queryByText('fixture-x')).toBeNull()
  })
})
