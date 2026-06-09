import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

/**
 * Issue 14 — PDP fullscreen swipeable gallery modal.
 *
 * The Gallery client island renders the existing hero + 2×2 grid as clickable
 * triggers and opens an accessible (Base UI Dialog) fullscreen modal showing the
 * clicked image. Navigation: on-screen prev/next buttons + ArrowRight/ArrowLeft
 * keys walk the images with WRAP; ESC closes (Dialog owns ESC + focus-trap +
 * focus-restore). Trigger images carry honest alt text.
 *
 * next-intl is mocked so t() echoes the key (+ args) — we assert against stable
 * keys, never translated copy. next/image renders a plain <img> in jsdom, so
 * alt text + src are directly assertable.
 */

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string, vals?: Record<string, unknown>) =>
    vals ? `${key}:${JSON.stringify(vals)}` : key,
}))

import { Gallery } from '@/app/[locale]/(marketing)/experience/[slug]/gallery'

const IMAGES = [
  { url: '/img/hero.jpg', alt: 'Bir Billing camping mountain stay' },
  { url: '/img/two.jpg', alt: 'Tent under the stars', label: 'Activity' },
  { url: '/img/three.jpg', alt: 'Sunrise over the valley' },
  { url: '/img/four.jpg', alt: 'Group around the campfire' },
  { url: '/img/five.jpg', alt: 'Trail to the meeting point' },
]

afterEach(() => {
  cleanup()
})

function renderGallery() {
  return render(<Gallery images={IMAGES} title="Bir Billing camping" totalReal={5} />)
}

describe('Gallery — triggers + alt text', () => {
  it('renders every gallery tile as a button carrying the honest alt text', () => {
    renderGallery()
    // The hero + grid tiles are interactive triggers, each labelled by alt text.
    expect(screen.getByAltText('Bir Billing camping mountain stay')).toBeTruthy()
    expect(screen.getByAltText('Tent under the stars')).toBeTruthy()
    // The clickable openers are buttons (keyboard-reachable), not bare imgs.
    const openers = screen.getAllByRole('button')
    expect(openers.length).toBeGreaterThan(0)
  })

  it('does not render the dialog until a tile is opened', () => {
    renderGallery()
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})

describe('Gallery — opening the modal', () => {
  it('opens a dialog showing the clicked image', () => {
    renderGallery()
    // Click the third tile → dialog opens on that image.
    fireEvent.click(screen.getByAltText('Sunrise over the valley'))
    const dialog = screen.getByRole('dialog')
    expect(dialog).toBeTruthy()
    // The dialog shows the clicked image (alt is reused for the modal image).
    expect(within(dialog).getByAltText('Sunrise over the valley')).toBeTruthy()
    // Counter reflects the 1-based position out of total (3 / 5).
    expect(
      within(dialog).getByText('imageOf:{"current":3,"total":5}'),
    ).toBeTruthy()
  })
})

describe('Gallery — navigation (buttons + keyboard, with wrap)', () => {
  it('advances to the next image on the Next button', () => {
    renderGallery()
    fireEvent.click(screen.getByAltText('Bir Billing camping mountain stay'))
    const dialog = screen.getByRole('dialog')
    fireEvent.click(within(dialog).getByRole('button', { name: 'nextImage' }))
    expect(within(dialog).getByAltText('Tent under the stars')).toBeTruthy()
    expect(
      within(dialog).getByText('imageOf:{"current":2,"total":5}'),
    ).toBeTruthy()
  })

  it('retreats to the previous image on the Previous button', () => {
    renderGallery()
    fireEvent.click(screen.getByAltText('Sunrise over the valley')) // index 2
    const dialog = screen.getByRole('dialog')
    fireEvent.click(
      within(dialog).getByRole('button', { name: 'previousImage' }),
    )
    expect(within(dialog).getByAltText('Tent under the stars')).toBeTruthy()
  })

  it('navigates with ArrowRight / ArrowLeft keys', () => {
    renderGallery()
    fireEvent.click(screen.getByAltText('Bir Billing camping mountain stay'))
    const dialog = screen.getByRole('dialog')
    fireEvent.keyDown(dialog, { key: 'ArrowRight' })
    expect(within(dialog).getByAltText('Tent under the stars')).toBeTruthy()
    fireEvent.keyDown(dialog, { key: 'ArrowLeft' })
    expect(
      within(dialog).getByAltText('Bir Billing camping mountain stay'),
    ).toBeTruthy()
  })

  it('wraps from the last image to the first on Next', () => {
    renderGallery()
    fireEvent.click(screen.getByAltText('Trail to the meeting point')) // index 4 (last)
    const dialog = screen.getByRole('dialog')
    fireEvent.click(within(dialog).getByRole('button', { name: 'nextImage' }))
    expect(
      within(dialog).getByAltText('Bir Billing camping mountain stay'),
    ).toBeTruthy()
  })

  it('renders the optional per-image label only when the image carries one', () => {
    renderGallery()
    // Image index 1 carries a label; index 0 does not.
    fireEvent.click(screen.getByAltText('Tent under the stars'))
    let dialog = screen.getByRole('dialog')
    expect(within(dialog).getByText('Activity')).toBeTruthy()
    fireEvent.keyDown(dialog, { key: 'ArrowLeft' }) // → index 0 (no label)
    dialog = screen.getByRole('dialog')
    expect(within(dialog).queryByText('Activity')).toBeNull()
  })
})

describe('Gallery — closing', () => {
  it('closes on Escape (Dialog owns ESC)', () => {
    renderGallery()
    fireEvent.click(screen.getByAltText('Bir Billing camping mountain stay'))
    expect(screen.getByRole('dialog')).toBeTruthy()
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})
