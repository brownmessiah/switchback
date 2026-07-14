import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Home-redesign issue 05 (CR8) — swipeable feature carousel below the hero.
 *
 * Hand-rolled (decision D6: CSS scroll-snap + interval autoplay + dot
 * buttons, no carousel dependency). Contract:
 *   - 4 pill cards (icon-left + bold text) from i18n keys; pagination dots
 *     with aria-current; dot click navigates.
 *   - Autoplay advances automatically; pauses on hover AND focus-within;
 *     disabled entirely under prefers-reduced-motion.
 *   - Copy honesty (D0/D7): the cancellation card must NOT promise
 *     "cancel or modify anytime" — cancellation is preset-scoped
 *     (ADR-0005), so the copy stays within-policy.
 *   - Replaces the hero brand line ("Book the scene you want to live.").
 */

function mockMatchMedia(reduceMotion: boolean): void {
  vi.stubGlobal(
    'matchMedia',
    vi.fn().mockReturnValue({
      matches: reduceMotion,
      media: '(prefers-reduced-motion: reduce)',
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      onchange: null,
      dispatchEvent: vi.fn(),
    } as unknown as MediaQueryList),
  )
}

vi.mock('next-intl', () => ({
  useTranslations:
    (ns: string) =>
    (key: string, values?: Record<string, unknown>) =>
      values ? `${ns}.${key}:${JSON.stringify(values)}` : `${ns}.${key}`,
}))

import {
  HomeFeatureCarousel,
  deriveCarouselIndex,
} from '@/components/home/feature-carousel'

const ROOT = resolve(__dirname, '../../..')
const INTERVAL = 5000

const ITEM_KEYS = ['verified', 'flexible', 'cancellation', 'explore'] as const

function cards(container: HTMLElement): HTMLElement[] {
  return Array.from(
    container.querySelectorAll<HTMLElement>('[data-testid="feature-card"]'),
  )
}

function dots(container: HTMLElement): HTMLButtonElement[] {
  return Array.from(
    container.querySelectorAll<HTMLButtonElement>(
      '[data-testid="feature-carousel-dot"]',
    ),
  )
}

function activeDotIndex(container: HTMLElement): number {
  return dots(container).findIndex(
    (d) => d.getAttribute('aria-current') === 'true',
  )
}

const originalScrollTo = Element.prototype.scrollTo

beforeEach(() => {
  vi.useFakeTimers()
  // jsdom has no Element.scrollTo — the component scrolls its track.
  Element.prototype.scrollTo = vi.fn()
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.unstubAllGlobals()
  Element.prototype.scrollTo = originalScrollTo
})

describe('HomeFeatureCarousel — structure', () => {
  it('renders the four feature cards with icon + text from i18n keys', () => {
    mockMatchMedia(false)
    const { container } = render(<HomeFeatureCarousel />)

    const items = cards(container)
    expect(items).toHaveLength(4)
    for (const [i, key] of ITEM_KEYS.entries()) {
      expect(items[i].textContent).toContain(
        `HomePage.featureCarousel.items.${key}`,
      )
      const svg = items[i].querySelector('svg')
      expect(svg, `card ${key} missing icon`).toBeTruthy()
      expect(svg?.getAttribute('aria-hidden')).toBe('true')
    }
    // All four icons distinct (no copy-paste reuse).
    const iconHtml = items.map((c) => c.querySelector('svg')?.innerHTML)
    expect(new Set(iconHtml).size).toBe(4)
  })

  it('renders four dot buttons with accessible labels; the first is current', () => {
    mockMatchMedia(false)
    const { container } = render(<HomeFeatureCarousel />)

    const dotButtons = dots(container)
    expect(dotButtons).toHaveLength(4)
    expect(activeDotIndex(container)).toBe(0)
    for (const dot of dotButtons) {
      expect(dot.tagName).toBe('BUTTON')
      expect(dot.getAttribute('type')).toBe('button')
      expect(dot.getAttribute('aria-label')).toBeTruthy()
    }
  })

  it('is exposed as a labelled region', () => {
    mockMatchMedia(false)
    const { container } = render(<HomeFeatureCarousel />)
    const section = container.querySelector('section')
    expect(section?.getAttribute('aria-label')).toBeTruthy()
  })
})

describe('deriveCarouselIndex (pure scroll-position → index)', () => {
  it('maps resting positions to their index and clamps to bounds', () => {
    expect(deriveCarouselIndex(0, 400, 4)).toBe(0)
    expect(deriveCarouselIndex(400, 400, 4)).toBe(1)
    expect(deriveCarouselIndex(1200, 400, 4)).toBe(3)
    // Overscroll / bounce clamps.
    expect(deriveCarouselIndex(-80, 400, 4)).toBe(0)
    expect(deriveCarouselIndex(99999, 400, 4)).toBe(3)
  })

  it('rounds mid-flight positions to the NEAREST card', () => {
    expect(deriveCarouselIndex(150, 400, 4)).toBe(0)
    expect(deriveCarouselIndex(250, 400, 4)).toBe(1)
  })

  it('is safe on a zero/negative stride (jsdom, unlaid-out DOM)', () => {
    expect(deriveCarouselIndex(500, 0, 4)).toBe(0)
    expect(deriveCarouselIndex(500, -10, 4)).toBe(0)
  })
})

describe('HomeFeatureCarousel — navigation', () => {
  it('dot click activates that card AND stops autoplay (manual takeover)', () => {
    mockMatchMedia(false)
    const { container } = render(<HomeFeatureCarousel />)

    act(() => {
      fireEvent.click(dots(container)[2])
    })
    expect(activeDotIndex(container)).toBe(2)

    // WCAG 2.2.2-motivated: any manual interaction permanently stops the
    // auto-advance (touch users have no hover to pause with).
    act(() => {
      vi.advanceTimersByTime(INTERVAL * 3)
    })
    expect(activeDotIndex(container)).toBe(2)
  })

  it('manual swipe (native scroll) syncs the active dot and stops autoplay', () => {
    mockMatchMedia(false)
    const { container } = render(<HomeFeatureCarousel />)
    const track = container.querySelector<HTMLElement>(
      '[data-testid="feature-carousel-track"]',
    )!

    // Simulate a laid-out track: one 400px card per view.
    Object.defineProperty(track, 'clientWidth', {
      value: 400,
      configurable: true,
    })
    // A finger lands on the track (stops autoplay), then drags to card 2.
    fireEvent.pointerDown(track)
    track.scrollLeft = 800
    act(() => {
      fireEvent.scroll(track)
    })
    expect(activeDotIndex(container)).toBe(2)

    act(() => {
      vi.advanceTimersByTime(INTERVAL * 2)
    })
    expect(activeDotIndex(container)).toBe(2)
  })

  it('autoplay advances and wraps', () => {
    mockMatchMedia(false)
    const { container } = render(<HomeFeatureCarousel />)

    act(() => {
      vi.advanceTimersByTime(INTERVAL)
    })
    expect(activeDotIndex(container)).toBe(1)

    act(() => {
      vi.advanceTimersByTime(INTERVAL * 3)
    })
    expect(activeDotIndex(container)).toBe(0)
  })

  it('pauses on hover and resumes on leave', () => {
    mockMatchMedia(false)
    const { container } = render(<HomeFeatureCarousel />)
    const section = container.querySelector('section')!

    fireEvent.mouseEnter(section)
    act(() => {
      vi.advanceTimersByTime(INTERVAL * 2)
    })
    expect(activeDotIndex(container)).toBe(0)

    fireEvent.mouseLeave(section)
    act(() => {
      vi.advanceTimersByTime(INTERVAL)
    })
    expect(activeDotIndex(container)).toBe(1)
  })

  it('pauses while focus is inside (keyboard users are not yanked around)', () => {
    mockMatchMedia(false)
    const { container } = render(<HomeFeatureCarousel />)
    const firstDot = dots(container)[0]

    act(() => {
      firstDot.focus()
    })
    act(() => {
      vi.advanceTimersByTime(INTERVAL * 2)
    })
    expect(activeDotIndex(container)).toBe(0)
  })

  it('prefers-reduced-motion disables autoplay entirely (manual nav still works)', () => {
    mockMatchMedia(true)
    const { container } = render(<HomeFeatureCarousel />)

    act(() => {
      vi.advanceTimersByTime(INTERVAL * 4)
    })
    expect(activeDotIndex(container)).toBe(0)

    act(() => {
      fireEvent.click(dots(container)[3])
    })
    expect(activeDotIndex(container)).toBe(3)
  })
})

describe('feature carousel copy honesty (D0/D7 — en.json)', () => {
  const en = JSON.parse(
    readFileSync(resolve(ROOT, 'lib/i18n/messages/en.json'), 'utf-8'),
  ) as {
    HomePage?: { featureCarousel?: { items?: Record<string, string> } }
  }
  const items = en.HomePage?.featureCarousel?.items

  it('carries the four feature messages', () => {
    expect(items).toBeTruthy()
    expect(Object.keys(items ?? {}).sort()).toEqual([...ITEM_KEYS].sort())
    expect(items?.verified).toBe('Book verified experiences')
    expect(items?.flexible).toBe('Stay flexible')
    expect(items?.explore).toBe('Explore best experiences around you')
  })

  it('the cancellation message never over-promises (ADR-0005 presets, D7)', () => {
    const cancellation = items?.cancellation ?? ''
    expect(cancellation.length).toBeGreaterThan(0)
    // The brief's "Cancel or modify anytime" is a blanket claim the product
    // does not honor (preset windows; outside-policy -> Dispute). D7 softens.
    expect(cancellation.toLowerCase()).not.toContain('anytime')
    expect(cancellation.toLowerCase()).not.toContain('modify')
    expect(cancellation).toMatch(/within policy/i)
  })
})

describe('home page wiring (issue 05)', () => {
  const source = readFileSync(
    resolve(ROOT, 'app/[locale]/(marketing)/page.tsx'),
    'utf-8',
  )

  it('mounts the carousel below the hero and drops the brand line', () => {
    expect(source).toContain('HomeFeatureCarousel')
    expect(source).not.toContain("t('hero.brandLine')")
    // Order: carousel section sits after the hero section, before destinations.
    const heroIdx = source.indexOf("t('hero.title')")
    const carouselIdx = source.indexOf('<HomeFeatureCarousel')
    const destinationsIdx = source.indexOf("t('destinations.heading')")
    expect(carouselIdx).toBeGreaterThan(heroIdx)
    expect(carouselIdx).toBeLessThan(destinationsIdx)
  })
})
