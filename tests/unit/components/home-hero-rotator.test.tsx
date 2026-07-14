import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { ComponentProps } from 'react'

import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Home-redesign issue 04 — auto-rotating hero image.
 *
 * Contract:
 *   - The rotator crossfades through the pool automatically (no interaction),
 *     but only advances onto a slide whose image has actually LOADED — on a
 *     slow network it holds the current frame (never fades to blank scrim).
 *   - The FIRST image keeps `priority` (it is the LCP element, preloaded by
 *     the server render); later slides mount progressively (active + one
 *     ahead) and load EAGERLY once mounted (mounting IS the preload gate —
 *     the browser's lazy threshold must not defeat it).
 *   - `prefers-reduced-motion: reduce` disables auto-advance entirely — a
 *     single static image renders.
 *   - Imagery is decorative: empty alt, presentation role, inactive slides
 *     aria-hidden.
 */

vi.mock('next/image', () => ({
  default: (
    props: ComponentProps<'img'> & { fill?: boolean; priority?: boolean },
  ) => {
    const { src, alt, priority, loading, onLoad } = props
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={typeof src === 'string' ? src : ''}
        alt={alt ?? ''}
        loading={loading}
        onLoad={onLoad}
        data-priority={priority ? 'true' : 'false'}
      />
    )
  },
}))

import { HeroRotator } from '@/components/home/hero-rotator'

const POOL = [
  'https://images.unsplash.com/photo-aaa?w=1600&h=900',
  'https://images.unsplash.com/photo-bbb?w=1600&h=900',
  'https://images.unsplash.com/photo-ccc?w=1600&h=900',
  'https://images.unsplash.com/photo-ddd?w=1600&h=900',
]

const INTERVAL = 6000

function mockMatchMedia(reduceMotion: boolean): ReturnType<typeof vi.fn> {
  const fn = vi.fn().mockReturnValue({
    matches: reduceMotion,
    media: '(prefers-reduced-motion: reduce)',
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    onchange: null,
    dispatchEvent: vi.fn(),
  } as unknown as MediaQueryList)
  vi.stubGlobal('matchMedia', fn)
  return fn
}

function slides(container: HTMLElement): HTMLElement[] {
  return Array.from(
    container.querySelectorAll<HTMLElement>('[data-testid="hero-slide"]'),
  )
}

function activeSrcs(container: HTMLElement): string[] {
  return slides(container)
    .filter((s) => s.dataset.active === 'true')
    .map((s) => s.querySelector('img')?.getAttribute('src') ?? '')
}

/** Fire the load event on every mounted slide image (network completed). */
function loadAllImages(container: HTMLElement): void {
  for (const img of Array.from(container.querySelectorAll('img'))) {
    fireEvent.load(img)
  }
}

/** Advance one rotation tick with all mounted images loaded. */
function tick(container: HTMLElement): void {
  // Flush the 0-timeout preload task first so the upcoming frame is mounted,
  // then complete its download, then let the interval fire.
  act(() => {
    vi.advanceTimersByTime(0)
  })
  loadAllImages(container)
  act(() => {
    vi.advanceTimersByTime(INTERVAL)
  })
}

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('HeroRotator — auto-advance', () => {
  it('starts on the first (LCP) image and advances automatically once frames load', () => {
    mockMatchMedia(false)
    const { container } = render(<HeroRotator images={POOL} intervalMs={INTERVAL} />)

    expect(activeSrcs(container)).toEqual([POOL[0]])

    tick(container)
    expect(activeSrcs(container)).toEqual([POOL[1]])

    tick(container)
    expect(activeSrcs(container)).toEqual([POOL[2]])
  })

  it('wraps back to the first image after a full cycle', () => {
    mockMatchMedia(false)
    const { container } = render(<HeroRotator images={POOL} intervalMs={INTERVAL} />)

    for (let i = 0; i < POOL.length; i += 1) {
      tick(container)
    }
    expect(activeSrcs(container)).toEqual([POOL[0]])
  })

  it('holds the current frame when the next image has not loaded (no blank fade)', () => {
    mockMatchMedia(false)
    const { container } = render(<HeroRotator images={POOL} intervalMs={INTERVAL} />)

    // Slide 1 mounts (preload) but its image never fires `load`.
    act(() => {
      vi.advanceTimersByTime(INTERVAL * 3)
    })
    // Rotation must NOT advance onto an undecoded frame.
    expect(activeSrcs(container)).toEqual([POOL[0]])

    // The pending frame finishes downloading -> the next tick advances.
    loadAllImages(container)
    act(() => {
      vi.advanceTimersByTime(INTERVAL)
    })
    expect(activeSrcs(container)).toEqual([POOL[1]])
  })

  it('only the first image carries priority; later slides load eagerly once mounted', () => {
    mockMatchMedia(false)
    const { container } = render(<HeroRotator images={POOL} intervalMs={INTERVAL} />)

    for (let i = 0; i < POOL.length; i += 1) {
      tick(container)
    }
    const imgs = Array.from(container.querySelectorAll('img'))
    expect(imgs.length).toBeGreaterThan(1)
    expect(imgs[0].dataset.priority).toBe('true')
    for (const img of imgs.slice(1)) {
      expect(img.dataset.priority).toBe('false')
      // Mounting is the preload gate — the browser lazy threshold must not
      // defer these fetches (the hero may be scrolled out of view).
      expect(img.getAttribute('loading')).toBe('eager')
    }
  })

  it('mounts slides progressively: 1 at render, 2 after the preload task, 3 after a tick', () => {
    mockMatchMedia(false)
    const { container } = render(<HeroRotator images={POOL} intervalMs={INTERVAL} />)

    // Server/first client render: only the LCP frame.
    expect(slides(container).length).toBe(1)

    // The 0-timeout preload task mounts the second frame.
    act(() => {
      vi.advanceTimersByTime(0)
    })
    expect(slides(container).length).toBe(2)

    tick(container)
    expect(slides(container).length).toBe(3)
  })

  it('marks inactive slides aria-hidden and every image decorative (empty alt)', () => {
    mockMatchMedia(false)
    const { container } = render(<HeroRotator images={POOL} intervalMs={INTERVAL} />)

    tick(container)
    for (const slide of slides(container)) {
      if (slide.dataset.active !== 'true') {
        expect(slide.getAttribute('aria-hidden')).toBe('true')
      }
      expect(slide.querySelector('img')?.getAttribute('alt')).toBe('')
    }
  })

  it('clears its timers on unmount', () => {
    mockMatchMedia(false)
    const clearIntervalSpy = vi.spyOn(window, 'clearInterval')
    const { unmount } = render(<HeroRotator images={POOL} intervalMs={INTERVAL} />)

    unmount()
    expect(clearIntervalSpy).toHaveBeenCalled()
  })
})

describe('HeroRotator — prefers-reduced-motion', () => {
  it('queries the exact reduced-motion media feature', () => {
    const matchMediaMock = mockMatchMedia(false)
    render(<HeroRotator images={POOL} intervalMs={INTERVAL} />)
    expect(matchMediaMock).toHaveBeenCalledWith('(prefers-reduced-motion: reduce)')
  })

  it('renders a single static image and never advances', () => {
    mockMatchMedia(true)
    const { container } = render(<HeroRotator images={POOL} intervalMs={INTERVAL} />)

    expect(activeSrcs(container)).toEqual([POOL[0]])

    loadAllImages(container)
    act(() => {
      vi.advanceTimersByTime(INTERVAL * POOL.length * 2)
    })
    expect(activeSrcs(container)).toEqual([POOL[0]])
    // No hidden extra slides accumulate either — the pool stays unmounted.
    expect(slides(container).length).toBe(1)
  })
})

describe('HeroRotator — degenerate pools', () => {
  it('a single-image pool renders statically without an interval', () => {
    mockMatchMedia(false)
    const { container } = render(
      <HeroRotator images={[POOL[0]]} intervalMs={INTERVAL} />,
    )

    loadAllImages(container)
    act(() => {
      vi.advanceTimersByTime(INTERVAL * 3)
    })
    expect(activeSrcs(container)).toEqual([POOL[0]])
    expect(slides(container).length).toBe(1)
  })
})

describe('home page wiring (issue 04)', () => {
  const source = readFileSync(
    resolve(__dirname, '../../../app/[locale]/(marketing)/page.tsx'),
    'utf-8',
  )

  it('mounts HeroRotator with the pool instead of a single hero <Image>', () => {
    expect(source).toContain('<HeroRotator')
    expect(source).toContain('getHeroImages()')
    expect(source).not.toContain('getHeroImage()')
  })
})
