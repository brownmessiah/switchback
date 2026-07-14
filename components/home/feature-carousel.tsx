'use client'

import type { ReactElement } from 'react'
import { useEffect, useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import {
  BadgeCheck,
  CalendarClock,
  Compass,
  Undo2,
  type LucideIcon,
} from 'lucide-react'

/**
 * Swipeable feature carousel below the homepage hero (home-redesign issue
 * 05 / CR8). Replaces the hero brand line.
 *
 * Hand-rolled per decision D6 — CSS scroll-snap track + a small interval
 * autoplay + dot buttons; no carousel dependency (embla is the documented
 * fallback only if gesture polish proves fiddly).
 *
 * NOTE — ADR-0018 exception: ADR-0018 bans horizontal scroll on mobile;
 * this track is an INTENTIONAL, documented exception (one snap-locked card
 * per view, swipe as the primary gesture — see the amendment note in
 * docs/adr/0018). The page itself never scrolls horizontally.
 *
 * Copy honesty (D0/D7): the cancellation card reads "within policy" — the
 * brief's "Cancel or modify anytime" is a blanket claim ADR-0005's preset
 * windows do not honor, so it was softened (decision D7).
 *
 * Motion model:
 *   - Autoplay pauses on hover / focus-within, and STOPS PERMANENTLY on any
 *     manual interaction (dot click, touch/pointer/wheel on the track) —
 *     touch users have no hover to pause with (WCAG 2.2.2).
 *   - prefers-reduced-motion disables autoplay entirely (JS matchMedia —
 *     CSS cannot stop an interval; sampled per effect run, no change
 *     listener: toggling the OS setting mid-session applies on next mount).
 *   - Programmatic smooth scrolls register an in-flight target; scroll
 *     events are ignored until the track settles there, so mid-animation
 *     positions never drive the dots (they'd double-blink every tick).
 */

const AUTOPLAY_MS = 5000

type FeatureKey = 'verified' | 'flexible' | 'cancellation' | 'explore'

const ITEMS: ReadonlyArray<{ key: FeatureKey; Icon: LucideIcon }> = [
  { key: 'verified', Icon: BadgeCheck },
  { key: 'flexible', Icon: CalendarClock },
  { key: 'cancellation', Icon: Undo2 },
  { key: 'explore', Icon: Compass },
]

/**
 * Map a scroll position to the nearest card index, clamped to bounds.
 * Pure — unit-tested directly (jsdom cannot lay out the snap track).
 * NOTE: assumes LTR scroll coordinates. The site renders every locale LTR
 * today (no `dir="rtl"` on <html>); a future RTL pass must revisit the
 * sign of scrollLeft here.
 */
export function deriveCarouselIndex(
  scrollLeft: number,
  stride: number,
  count: number,
): number {
  if (stride <= 0) return 0
  return Math.max(0, Math.min(count - 1, Math.round(scrollLeft / stride)))
}

/** Distance between adjacent cards (card width + gap), from live layout. */
function cardStride(track: HTMLElement): number {
  const first = track.children[0] as HTMLElement | undefined
  const second = track.children[1] as HTMLElement | undefined
  const measured = (second?.offsetLeft ?? 0) - (first?.offsetLeft ?? 0)
  return measured > 0 ? measured : track.clientWidth
}

export function HomeFeatureCarousel(): ReactElement {
  const t = useTranslations('HomePage')
  const trackRef = useRef<HTMLUListElement>(null)
  // Where a programmatic smooth scroll is headed; scroll events are ignored
  // while the track is in flight toward it (see docstring).
  const scrollTargetRef = useRef<number | null>(null)
  // Set when the active index changed FROM a manual scroll — the sync
  // effect must not scrollTo against the user's in-progress gesture.
  const fromScrollRef = useRef(false)
  const [active, setActive] = useState(0)
  const [paused, setPaused] = useState(false)
  const [stopped, setStopped] = useState(false)

  // Static, pre-resolved label map (string-literal keys only — next-intl
  // static analysis must see every key; same pattern as trust.tsx).
  const labels: Record<FeatureKey, string> = {
    verified: t('featureCarousel.items.verified'),
    flexible: t('featureCarousel.items.flexible'),
    cancellation: t('featureCarousel.items.cancellation'),
    explore: t('featureCarousel.items.explore'),
  }

  // Keep the snap track in sync with the active index (dot clicks +
  // autoplay).
  useEffect(() => {
    if (fromScrollRef.current) {
      fromScrollRef.current = false
      return
    }
    const track = trackRef.current
    const card = track?.children[active] as HTMLElement | undefined
    if (!track || !card) return
    const left = card.offsetLeft - track.offsetLeft
    if (Math.abs(track.scrollLeft - left) <= 2) return // already there
    scrollTargetRef.current = left
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    track.scrollTo({ left, behavior: reduce ? 'auto' : 'smooth' })
  }, [active])

  // Autoplay. Re-armed after every activation so a manual selection gets a
  // full interval before advancing again.
  useEffect(() => {
    if (paused || stopped) return
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    const id = window.setInterval(() => {
      setActive((a) => (a + 1) % ITEMS.length)
    }, AUTOPLAY_MS)
    return () => window.clearInterval(id)
  }, [paused, stopped, active])

  const onScroll = (): void => {
    const track = trackRef.current
    if (!track || track.clientWidth === 0) return
    if (scrollTargetRef.current !== null) {
      if (Math.abs(track.scrollLeft - scrollTargetRef.current) > 2) {
        return // programmatic scroll in flight — mid-animation positions lie
      }
      scrollTargetRef.current = null // settled at the target
      return
    }
    const idx = deriveCarouselIndex(
      track.scrollLeft,
      cardStride(track),
      ITEMS.length,
    )
    if (idx !== active) {
      fromScrollRef.current = true
      setActive(idx)
    }
  }

  // Any direct gesture on the track = manual takeover: stop autoplay for
  // good and stop ignoring scroll events (the user owns the position now).
  const onManualTakeover = (): void => {
    scrollTargetRef.current = null
    setStopped(true)
  }

  return (
    <section
      aria-label={t('featureCarousel.label')}
      className="border-b border-border bg-card"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
    >
      <div className="mx-auto max-w-xl px-4 py-4 sm:px-6">
        <ul
          ref={trackRef}
          onScroll={onScroll}
          onPointerDown={onManualTakeover}
          onTouchStart={onManualTakeover}
          onWheel={onManualTakeover}
          className="flex snap-x snap-mandatory gap-3 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          data-testid="feature-carousel-track"
        >
          {ITEMS.map(({ key, Icon }) => (
            <li
              key={key}
              data-testid="feature-card"
              className="flex w-full shrink-0 snap-center items-center justify-center gap-3 rounded-[var(--radius-pill)] border border-border bg-background px-6 py-3"
            >
              <span className="inline-flex size-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary-strong">
                <Icon className="size-4" aria-hidden="true" />
              </span>
              <p className="text-sm font-semibold">{labels[key]}</p>
            </li>
          ))}
        </ul>

        <div className="mt-3 flex justify-center gap-1">
          {ITEMS.map((item, i) => (
            <button
              key={item.key}
              type="button"
              data-testid="feature-carousel-dot"
              aria-label={t('featureCarousel.dotLabel', { number: i + 1 })}
              aria-current={i === active ? 'true' : undefined}
              onClick={() => {
                setStopped(true)
                setActive(i)
              }}
              className="min-tap inline-flex items-center justify-center"
            >
              <span
                aria-hidden="true"
                className={`size-2.5 rounded-full transition-colors motion-reduce:transition-none ${
                  i === active
                    ? 'bg-primary'
                    : 'bg-border hover:bg-muted-foreground/50'
                }`}
              />
            </button>
          ))}
        </div>
      </div>
    </section>
  )
}
