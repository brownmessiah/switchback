'use client'

import { useCallback, useRef, useState } from 'react'
import type { KeyboardEvent, ReactElement, TouchEvent } from 'react'

import Image from 'next/image'
import { ChevronLeft, ChevronRight, Images, X } from 'lucide-react'
import { useTranslations } from 'next-intl'

import { Dialog, DialogPortal } from '@/components/ui/dialog'
import { Dialog as DialogPrimitive } from '@base-ui/react/dialog'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { nextIndex, prevIndex } from '@/lib/media/gallery-nav'

export interface GalleryImage {
  /** Resolved image URL (real media or activity fallback). */
  url: string
  /** Honest alt text describing the Experience; never fabricated. */
  alt: string
  /**
   * Optional per-image label (e.g. "Activity", "Meeting point"). Rendered ONLY
   * when present (D0 — no fabricated categories). Omit when no data backs it.
   */
  label?: string
}

export interface GalleryProps {
  /** The hero (index 0) + grid tiles, in display order. */
  images: GalleryImage[]
  /** The Experience title — modal heading + a11y label fallback. */
  title: string
  /**
   * Count of REAL uploaded media assets (not fallbacks). Drives the
   * "show all photos" count badge, surfaced only when there is genuine extra
   * media (> 3 real assets) to reveal — matching the prior PDP affordance.
   */
  totalReal: number
}

// Minimum horizontal travel (px) before a touch is treated as a swipe rather
// than a tap/scroll. Keeps accidental drags from flipping the image.
const SWIPE_THRESHOLD = 48

/**
 * Issue 14 — PDP fullscreen swipeable gallery modal.
 *
 * Renders the Airbnb-style hero + 2×2 grid (unchanged layout) as keyboard-
 * reachable triggers. Clicking any tile opens a fullscreen Base UI Dialog (which
 * provides focus-trap, ESC-to-close, and focus-restore for free → axe-clean
 * dialog semantics) showing that image. Navigation: on-screen prev/next +
 * ArrowRight/ArrowLeft keys + mobile swipe, all WRAPPING via the pure
 * `nextIndex`/`prevIndex` walk. An optional per-image label renders only when
 * the image carries one (no fabricated labels). All non-hero images lazy-load.
 */
export function Gallery({ images, title, totalReal }: GalleryProps): ReactElement {
  const t = useTranslations('Gallery')

  const [open, setOpen] = useState(false)
  const [index, setIndex] = useState(0)
  const total = images.length
  const touchStartX = useRef<number | null>(null)

  const openAt = useCallback((i: number) => {
    setIndex(i)
    setOpen(true)
  }, [])

  const goNext = useCallback(() => {
    setIndex((i) => nextIndex(i, total))
  }, [total])

  const goPrev = useCallback(() => {
    setIndex((i) => prevIndex(i, total))
  }, [total])

  const onKeyDown = useCallback(
    (e: KeyboardEvent<HTMLDivElement>) => {
      // ESC is handled by the Dialog primitive; we only own left/right.
      if (e.key === 'ArrowRight') {
        e.preventDefault()
        goNext()
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault()
        goPrev()
      }
    },
    [goNext, goPrev],
  )

  const onTouchStart = useCallback((e: TouchEvent<HTMLDivElement>) => {
    touchStartX.current = e.touches[0]?.clientX ?? null
  }, [])

  const onTouchEnd = useCallback(
    (e: TouchEvent<HTMLDivElement>) => {
      const start = touchStartX.current
      touchStartX.current = null
      if (start === null) return
      const delta = (e.changedTouches[0]?.clientX ?? start) - start
      if (Math.abs(delta) < SWIPE_THRESHOLD) return
      // Swipe left (negative delta) advances; swipe right retreats.
      if (delta < 0) goNext()
      else goPrev()
    },
    [goNext, goPrev],
  )

  const active = images[index]
  const showAllPhotos = totalReal > 3

  return (
    <>
      {/* Airbnb-grade hero+grid (1 large hero + a 2×2 grid), full content width
          above the title. Each tile is a <button> opening the fullscreen modal
          on that image — keyboard-reachable, focus-visible, no layout shift. */}
      <div className="group/gallery relative mb-[var(--space-section)] grid aspect-[3/2] grid-cols-1 gap-2 overflow-hidden rounded-[var(--radius-2xl)] ring-1 ring-foreground/10 md:aspect-[2/1] md:grid-cols-4 md:grid-rows-2">
        {/* Hero — spans both rows + half the width on ≥md. */}
        <button
          type="button"
          onClick={() => openAt(0)}
          aria-label={t('openGallery')}
          className="relative cursor-zoom-in focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring md:col-span-2 md:row-span-2"
        >
          <Image
            src={images[0]!.url}
            alt={images[0]!.alt}
            fill
            className="object-cover transition-[filter] duration-[var(--duration-base)] group-hover/gallery:brightness-[0.97]"
            priority
            sizes="(max-width: 768px) 100vw, 50vw"
          />
        </button>
        {/* 2×2 grid — hidden on mobile so the hero leads cleanly. Lazy-loaded. */}
        {[1, 2, 3, 4].map((i) => (
          <button
            key={i}
            type="button"
            onClick={() => openAt(i)}
            aria-label={t('openGallery')}
            className="relative hidden cursor-zoom-in focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring md:block"
          >
            <Image
              src={images[i]!.url}
              alt={images[i]!.alt}
              fill
              className="object-cover transition-[filter] duration-[var(--duration-base)] group-hover/gallery:brightness-[0.97]"
              loading="lazy"
              sizes="25vw"
            />
          </button>
        ))}
        {/* "Show all photos" affordance — now opens the modal at the hero. */}
        {showAllPhotos && (
          <button
            type="button"
            onClick={() => openAt(0)}
            className="absolute bottom-3 right-3 inline-flex items-center gap-1.5 rounded-[var(--radius-control)] border border-border bg-background/95 px-3 py-1.5 text-xs font-semibold text-foreground shadow-sm backdrop-blur tabular-nums transition-colors hover:bg-background focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          >
            <Images aria-hidden="true" className="size-3.5 shrink-0" />
            <span>{t('viewAllPhotos', { count: totalReal })}</span>
          </button>
        )}
      </div>

      {/* Fullscreen modal — Base UI Dialog (focus-trap + ESC + focus-restore). */}
      <Dialog open={open} onOpenChange={setOpen} modal>
        <DialogPortal>
          <DialogPrimitive.Backdrop
            data-slot="gallery-overlay"
            className="fixed inset-0 z-50 bg-black/90 duration-100 data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0"
          />
          <DialogPrimitive.Popup
            data-slot="gallery-content"
            aria-label={title}
            className="fixed inset-0 z-50 flex flex-col bg-transparent text-white outline-none duration-100 data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0"
            onKeyDown={onKeyDown}
          >
            {/* Top bar — counter (left) + close (right). */}
            <div className="flex shrink-0 items-center justify-between gap-3 p-4">
              <DialogPrimitive.Title
                data-slot="gallery-title"
                className="text-sm font-medium tabular-nums"
              >
                {t('imageOf', { current: index + 1, total })}
              </DialogPrimitive.Title>
              <DialogPrimitive.Close
                data-slot="gallery-close"
                render={
                  <Button
                    variant="ghost"
                    size="icon"
                    className="text-white hover:bg-white/15 hover:text-white"
                  />
                }
              >
                <X aria-hidden="true" />
                <span className="sr-only">{t('close')}</span>
              </DialogPrimitive.Close>
            </div>

            {/* Stage — the active image, with prev/next overlaid. */}
            <div
              className="relative flex min-h-0 flex-1 items-center justify-center px-2 pb-2 sm:px-14"
              onTouchStart={onTouchStart}
              onTouchEnd={onTouchEnd}
            >
              {active && (
                <div className="relative h-full w-full">
                  <Image
                    src={active.url}
                    alt={active.alt}
                    fill
                    className="object-contain"
                    sizes="100vw"
                    priority
                  />
                </div>
              )}

              {total > 1 && (
                <>
                  <button
                    type="button"
                    onClick={goPrev}
                    aria-label={t('previousImage')}
                    className={cn(
                      'absolute left-2 top-1/2 inline-flex size-10 -translate-y-1/2 items-center justify-center rounded-full bg-white/15 text-white backdrop-blur transition-colors hover:bg-white/30 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white sm:left-3 sm:size-11',
                    )}
                  >
                    <ChevronLeft aria-hidden="true" className="size-6" />
                  </button>
                  <button
                    type="button"
                    onClick={goNext}
                    aria-label={t('nextImage')}
                    className={cn(
                      'absolute right-2 top-1/2 inline-flex size-10 -translate-y-1/2 items-center justify-center rounded-full bg-white/15 text-white backdrop-blur transition-colors hover:bg-white/30 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white sm:right-3 sm:size-11',
                    )}
                  >
                    <ChevronRight aria-hidden="true" className="size-6" />
                  </button>
                </>
              )}
            </div>

            {/* Optional per-image label — rendered ONLY when data backs it. */}
            {active?.label && (
              <div className="shrink-0 px-4 pb-6 text-center">
                <span className="inline-block rounded-[var(--radius-control)] bg-white/15 px-3 py-1.5 text-sm font-medium backdrop-blur">
                  {active.label}
                </span>
              </div>
            )}
          </DialogPrimitive.Popup>
        </DialogPortal>
      </Dialog>
    </>
  )
}
