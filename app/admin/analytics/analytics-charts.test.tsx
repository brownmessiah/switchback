/**
 * Brand-chart token coverage for the admin analytics charts (#104).
 *
 * The as-is charts used an off-brand literal `hsl(...)` palette. DESIGN.md §2.1
 * requires charts to use the retained `--chart-1..5` token family (chart-1 is
 * the coral brand, charts 2–5 theme-invariant). These tests assert the palette
 * is the DESIGN.md token set — recharts accepts a CSS-var string for
 * fill/stroke, exactly as #74 vendor-dashboard did — and that each of the four
 * charts wires a chart token into its primary series.
 */

import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

afterEach(cleanup)

import {
  BookingVolumeChart,
  CATEGORY_CHART_TOKENS,
  CHART_TOKEN_BOOKINGS,
  CHART_TOKEN_REVENUE,
  CHART_TOKEN_VENDORS,
  CategoryPerformanceChart,
  RevenueTrendChart,
  VendorGrowthChart,
} from './analytics-charts'

describe('analytics brand-chart tokens (DESIGN.md §2.1)', () => {
  it('exposes only DESIGN.md --chart-* tokens (no off-brand hsl literals)', () => {
    const tokens = [
      CHART_TOKEN_REVENUE,
      CHART_TOKEN_BOOKINGS,
      CHART_TOKEN_VENDORS,
      ...CATEGORY_CHART_TOKENS,
    ]
    expect(tokens.length).toBeGreaterThan(0)
    for (const token of tokens) {
      expect(token).toMatch(/^var\(--chart-[1-5]\)$/)
      expect(token).not.toContain('hsl(')
    }
  })

  it('cycles the full chart-1..5 token family on the category pie', () => {
    expect(CATEGORY_CHART_TOKENS).toEqual([
      'var(--chart-1)',
      'var(--chart-2)',
      'var(--chart-3)',
      'var(--chart-4)',
      'var(--chart-5)',
    ])
  })

  it('binds the booking-volume bars to the coral brand chart-1 token', () => {
    // chart-1 tracks --primary (coral) per DESIGN.md §2.1.
    expect(CHART_TOKEN_BOOKINGS).toBe('var(--chart-1)')
    const { container } = render(
      <BookingVolumeChart data={[{ week: '2026-W01', value: 3 }]} />,
    )
    // The card wrapper carries a stable testid so the series binding is locatable.
    expect(container.querySelector('[data-testid="chart-booking-volume"]')).not.toBeNull()
    expect(
      container.querySelector('[data-chart-token="var(--chart-1)"]'),
    ).not.toBeNull()
  })

  it('binds the revenue-trend area to the green chart-2 token', () => {
    expect(CHART_TOKEN_REVENUE).toBe('var(--chart-2)')
    const { container } = render(
      <RevenueTrendChart data={[{ month: '2026-01', value: 1000 }]} />,
    )
    expect(container.querySelector('[data-testid="chart-revenue-trend"]')).not.toBeNull()
    expect(
      container.querySelector('[data-chart-token="var(--chart-2)"]'),
    ).not.toBeNull()
  })

  it('binds the vendor-growth line to the chart-5 token', () => {
    expect(CHART_TOKEN_VENDORS).toBe('var(--chart-5)')
    const { container } = render(
      <VendorGrowthChart data={[{ month: '2026-01', value: 2 }]} />,
    )
    expect(container.querySelector('[data-testid="chart-vendor-growth"]')).not.toBeNull()
    expect(
      container.querySelector('[data-chart-token="var(--chart-5)"]'),
    ).not.toBeNull()
  })

  it('marks the category pie with a chart-token data attribute', () => {
    const { container } = render(
      <CategoryPerformanceChart data={[{ name: 'kayaking', value: 5 }]} />,
    )
    expect(container.querySelector('[data-testid="chart-category-performance"]')).not.toBeNull()
    expect(
      container.querySelector('[data-chart-token="var(--chart-1)"]'),
    ).not.toBeNull()
  })
})
