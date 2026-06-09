import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { CompareToggle } from '@/components/compare/toggle'
import { CompareTray } from '@/components/compare/tray'
import {
  COMPARE_STORAGE_KEY,
  getCompareSlugs,
} from '@/lib/compare/storage'

// next-intl: t() returns the key so we assert on the i18n keys / can compute
// counts from rich-ish keys; the tray uses a count interpolation we assert via
// the testid + the slugs in storage instead of the rendered string.
vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
}))

afterEach(() => {
  cleanup()
  window.localStorage.clear()
})

beforeEach(() => {
  window.localStorage.clear()
})

describe('CompareToggle', () => {
  it('renders an unchecked toggle for a slug not in the selection', () => {
    render(<CompareToggle slug="rafting-rishikesh" />)
    const toggle = screen.getByTestId('compare-toggle') as HTMLInputElement
    expect(toggle.checked).toBe(false)
  })

  it('adds the slug to the selection when toggled on', async () => {
    render(<CompareToggle slug="rafting-rishikesh" />)
    fireEvent.click(screen.getByTestId('compare-toggle'))
    await waitFor(() => {
      expect(getCompareSlugs()).toEqual(['rafting-rishikesh'])
    })
  })

  it('removes the slug from the selection when toggled off', async () => {
    window.localStorage.setItem(
      COMPARE_STORAGE_KEY,
      JSON.stringify(['rafting-rishikesh']),
    )
    render(<CompareToggle slug="rafting-rishikesh" />)
    const toggle = screen.getByTestId('compare-toggle') as HTMLInputElement
    expect(toggle.checked).toBe(true)
    fireEvent.click(toggle)
    await waitFor(() => {
      expect(getCompareSlugs()).toEqual([])
    })
  })

  it('reflects the cap: when 3 OTHER slugs are selected and this one is not, the toggle is disabled', () => {
    window.localStorage.setItem(
      COMPARE_STORAGE_KEY,
      JSON.stringify(['a', 'b', 'c']),
    )
    render(<CompareToggle slug="d" />)
    const toggle = screen.getByTestId('compare-toggle') as HTMLInputElement
    expect(toggle.checked).toBe(false)
    expect(toggle.disabled).toBe(true)
  })

  it('is NOT disabled at the cap if THIS slug is one of the selected (so it can be removed)', () => {
    window.localStorage.setItem(
      COMPARE_STORAGE_KEY,
      JSON.stringify(['a', 'b', 'c']),
    )
    render(<CompareToggle slug="b" />)
    const toggle = screen.getByTestId('compare-toggle') as HTMLInputElement
    expect(toggle.checked).toBe(true)
    expect(toggle.disabled).toBe(false)
  })
})

describe('CompareTray', () => {
  it('renders nothing when the selection is empty (hidden when empty)', async () => {
    const { container } = render(<CompareTray />)
    await waitFor(() => {
      expect(container.querySelector('[data-testid="compare-tray"]')).toBeNull()
    })
  })

  it('renders the tray with a link to /compare when the selection is non-empty', async () => {
    window.localStorage.setItem(COMPARE_STORAGE_KEY, JSON.stringify(['a', 'b']))
    render(<CompareTray />)
    const tray = await screen.findByTestId('compare-tray')
    expect(tray).toBeTruthy()
    const cta = screen.getByTestId('compare-tray-cta')
    expect(cta.getAttribute('href')).toBe('/compare')
  })

  it('exposes the selection count via a data attribute', async () => {
    window.localStorage.setItem(COMPARE_STORAGE_KEY, JSON.stringify(['a', 'b']))
    render(<CompareTray />)
    const tray = await screen.findByTestId('compare-tray')
    expect(tray.getAttribute('data-count')).toBe('2')
  })

  it('clears the selection (and hides) when the clear control is clicked', async () => {
    window.localStorage.setItem(COMPARE_STORAGE_KEY, JSON.stringify(['a', 'b']))
    const { container } = render(<CompareTray />)
    await screen.findByTestId('compare-tray')
    fireEvent.click(screen.getByTestId('compare-tray-clear'))
    await waitFor(() => {
      expect(getCompareSlugs()).toEqual([])
    })
    await waitFor(() => {
      expect(container.querySelector('[data-testid="compare-tray"]')).toBeNull()
    })
  })

  it('updates live when a CompareToggle elsewhere changes the selection', async () => {
    const { container } = render(
      <>
        <CompareTray />
        <CompareToggle slug="rafting-rishikesh" />
      </>,
    )
    // Empty at first.
    expect(container.querySelector('[data-testid="compare-tray"]')).toBeNull()
    // Toggling a card on must surface the tray (same-page sync via event).
    fireEvent.click(screen.getByTestId('compare-toggle'))
    const tray = await screen.findByTestId('compare-tray')
    expect(tray.getAttribute('data-count')).toBe('1')
  })
})
