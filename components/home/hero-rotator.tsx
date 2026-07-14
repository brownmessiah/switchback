'use client'

import Image from 'next/image'
import type { ReactElement } from 'react'
import { useEffect, useState } from 'react'

/**
 * Auto-rotating homepage hero background (home-redesign issue 04 / CR1).
 *
 * Crossfades through an adventure photo pool with no user interaction:
 *   - Slide 0 is the LCP element: it renders in the server HTML with
 *     `priority` (preload), exactly like the static hero it replaces, so
 *     LCP on `/` does not regress. Rotation only starts after hydration.
 *   - Later slides mount PROGRESSIVELY (active + one ahead) so the whole
 *     pool is not downloaded up front; once a slide has mounted it stays
 *     mounted (monotonic high-water) to keep the wrap-around crossfade
 *     seamless.
 *   - `prefers-reduced-motion: reduce` disables auto-advance entirely — the
 *     hero stays a single static image (a JS check, because CSS
 *     `motion-reduce:` cannot stop an interval).
 *   - Purely decorative: empty alt + presentation role, inactive slides
 *     aria-hidden.
 *
 * Expects a positioned (`relative`/`absolute`) parent — slides fill it with
 * `absolute inset-0`, matching the wrapper the static hero <Image fill> used.
 */

const DEFAULT_INTERVAL_MS = 6000

interface HeroRotatorProps {
  readonly images: readonly string[]
  readonly intervalMs?: number
}

interface SlideState {
  readonly active: number
  readonly mounted: number
}

export function HeroRotator({
  images,
  intervalMs = DEFAULT_INTERVAL_MS,
}: HeroRotatorProps): ReactElement {
  // `mounted` starts at 1: the server HTML carries only the LCP frame. The
  // second slide mounts (and starts fetching) once the effect confirms
  // rotation will actually run — reduced-motion users never pay for it.
  const [{ active, mounted }, setSlides] = useState<SlideState>({
    active: 0,
    mounted: 1,
  })

  // Which pool URLs have finished downloading. A stable mutable Set (never
  // replaced, mutations don't need re-renders — the interval reads it at
  // tick time). Slide 0 is seeded: it is the SSR/LCP frame, and a cached
  // image's `load` can fire before hydration attaches the handler.
  const [loadedImages] = useState(() => new Set<string>([images[0]]))

  useEffect(() => {
    if (images.length <= 1) return
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return

    // Preload the next frame ahead of the first tick (in a task, not the
    // effect body, so hydration doesn't cascade an immediate re-render).
    const preloadId = window.setTimeout(() => {
      setSlides((s) => ({ ...s, mounted: Math.min(images.length, 2) }))
    }, 0)

    const id = window.setInterval(() => {
      setSlides((s) => {
        const next = (s.active + 1) % images.length
        const mountedNext = Math.min(images.length, Math.max(s.mounted, next + 2))
        // Hold the current frame until the incoming image has decoded —
        // fading onto an unloaded slide flashes blank scrim over the page
        // background. Keep mounting so the fetch proceeds; retry next tick.
        if (!loadedImages.has(images[next])) {
          return { active: s.active, mounted: mountedNext }
        }
        return { active: next, mounted: mountedNext }
      })
    }, intervalMs)
    return () => {
      window.clearTimeout(preloadId)
      window.clearInterval(id)
    }
  }, [images, intervalMs, loadedImages])

  return (
    <>
      {images.slice(0, mounted).map((src, i) => (
        <div
          key={src}
          data-testid="hero-slide"
          data-active={i === active ? 'true' : 'false'}
          aria-hidden={i === active ? undefined : true}
          className={`absolute inset-0 transition-opacity duration-1000 motion-reduce:transition-none ${
            i === active ? 'opacity-100' : 'opacity-0'
          }`}
        >
          <Image
            src={src}
            alt=""
            role="presentation"
            fill
            className="object-cover"
            priority={i === 0}
            // Mounting IS the preload gate: these frames must fetch even if
            // the hero is scrolled out of the lazy-load threshold.
            loading={i === 0 ? undefined : 'eager'}
            onLoad={() => {
              loadedImages.add(src)
            }}
            sizes="100vw"
          />
        </div>
      ))}
    </>
  )
}
