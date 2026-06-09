import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Issue 13 — Booking-box price transparency.
 *
 * The Booking rail's live breakdown must, for a Partial-pay Experience, show:
 *   base/total → 25% Advance now → balance later → a refundable/cancellation
 *   pointer (we do NOT fabricate a refundable rupee number; we point to the
 *   active cancellation preset, ADR-0005).
 *
 * AND it must respect the ADR-0001 carve-outs for DISPLAY accuracy:
 *   - slot <48h away  → 100% upfront (no balance row, full amount due now).
 *   - total > Rs.25,000 → 100% upfront (escrow).
 * The carve-out math is the pure `resolveDisplaySplit` (unit-tested in
 * lib/experiences/booking-price.test.ts); here we assert the rail RENDERS it.
 *
 * next-intl + the calendar/time-slot children are mocked: t() echoes a
 * key-with-args so we assert against stable keys, never translated copy.
 */

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string, vals?: Record<string, unknown>) =>
    vals ? `${key}:${JSON.stringify(vals)}` : key,
}))

// Calendar + time-slot picker children are unrelated to the breakdown under
// test; stub them so the rail mounts in jsdom without Intl date plumbing.
vi.mock(
  '@/app/[locale]/(marketing)/experience/[slug]/booking-calendar',
  () => ({ BookingCalendar: () => null }),
)
vi.mock(
  '@/app/[locale]/(marketing)/experience/[slug]/time-slot-list',
  () => ({ TimeSlotList: () => null }),
)

import { BookingRailInteractive } from '@/app/[locale]/(marketing)/experience/[slug]/booking-rail-interactive'

const PARTIAL_PAY_LABELS = {
  breakdownLabel: 'pricing.breakdown',
  notice: 'pricing.partialPay',
  advanceLabel: 'pricing.advanceDue',
  balanceLabel: 'pricing.balanceDue',
  refundablePointer: 'pricing.refundablePointer',
  fullUpfrontNotice: 'pricing.fullUpfront',
}

const CALENDAR_LABELS = {
  selectDate: 'calendar.selectDate',
  today: 'calendar.today',
  unavailable: 'calendar.unavailable',
  selected: 'calendar.selected',
  prevMonth: 'calendar.prevMonth',
  nextMonth: 'calendar.nextMonth',
  noDates: 'calendar.noDates',
}

const BASE_PROPS = {
  priceTableLabel: 'pricing.priceTable',
  brackets: [
    { label: 'pricing.tier1_2', priceRupees: 5000 },
    { label: 'pricing.tier3_5', priceRupees: 4500 },
    { label: 'pricing.tier6Plus', priceRupees: 4000 },
  ],
  perPersonLabel: 'pricing.perPerson',
  participantsLabel: 'pricing.participants',
  totalLabel: 'pricing.total',
  maxParticipants: 12,
  freeCancellation: 'pricing.freeCancellation',
  bookNowLabel: 'pricing.bookNow',
  checkoutHref: '/checkout?experienceId=e1',
  locale: 'en',
  calendarLabels: CALENDAR_LABELS,
  closure: null,
} as const

function hoursFromNow(h: number): { id: string; startAtISO: string; endAtISO: string; remaining: number } {
  const start = new Date(Date.now() + h * 60 * 60 * 1000)
  const end = new Date(start.getTime() + 2 * 60 * 60 * 1000)
  return {
    id: `slot-${h}`,
    startAtISO: start.toISOString(),
    endAtISO: end.toISOString(),
    remaining: 8,
  }
}

afterEach(() => {
  cleanup()
})

beforeEach(() => {
  vi.useRealTimers()
})

describe('BookingRailInteractive — price transparency (issue 13)', () => {
  it('shows the Advance, balance, AND a refundable/cancellation pointer for a default partial-pay slot (≥48h, ≤Rs.25,000)', () => {
    render(
      <BookingRailInteractive
        {...BASE_PROPS}
        partialPay={PARTIAL_PAY_LABELS}
        slots={[hoursFromNow(24 * 7)]} // T+7d → partial pay applies
      />,
    )
    // 1 participant × Rs.5000 = Rs.5000 total → 25% advance = Rs.1250, balance Rs.3750.
    expect(screen.getByText('pricing.advanceDue')).toBeTruthy()
    expect(screen.getByText('pricing.balanceDue')).toBeTruthy()
    expect(screen.getByText('₹1,250')).toBeTruthy()
    expect(screen.getByText('₹3,750')).toBeTruthy()
    // The refundable/cancellation pointer is present (no fabricated number).
    expect(screen.getByText('pricing.refundablePointer')).toBeTruthy()
    // The full-upfront notice is NOT shown for the default partial-pay case.
    expect(screen.queryByText('pricing.fullUpfront')).toBeNull()
  })

  it('shows 100% upfront (no balance row) when the selected slot starts <48h away (ADR-0001 carve-out)', () => {
    render(
      <BookingRailInteractive
        {...BASE_PROPS}
        partialPay={PARTIAL_PAY_LABELS}
        slots={[hoursFromNow(24)]} // <48h → coerced to full upfront
      />,
    )
    // Total Rs.5000 captured now; no balance-at-T-24h row.
    expect(screen.queryByText('pricing.balanceDue')).toBeNull()
    expect(screen.getByText('pricing.fullUpfront')).toBeTruthy()
    // The full total appears as the amount due now (also echoed in the total
    // row), so the whole Rs.5,000 is captured up front.
    expect(screen.getAllByText('₹5,000').length).toBeGreaterThanOrEqual(1)
    expect(screen.getByText('pricing.advanceDue')).toBeTruthy()
  })

  it('shows 100% upfront when the total exceeds Rs.25,000 (escrow carve-out)', () => {
    render(
      <BookingRailInteractive
        {...BASE_PROPS}
        brackets={[
          { label: 'pricing.tier1_2', priceRupees: 30000 },
          { label: 'pricing.tier3_5', priceRupees: 30000 },
          { label: 'pricing.tier6Plus', priceRupees: 30000 },
        ]}
        partialPay={PARTIAL_PAY_LABELS}
        slots={[hoursFromNow(24 * 7)]} // ≥48h, but >Rs.25,000
      />,
    )
    expect(screen.queryByText('pricing.balanceDue')).toBeNull()
    expect(screen.getByText('pricing.fullUpfront')).toBeTruthy()
  })

  it('shows only the total (no partial-pay split) when the Experience disallows partial pay', () => {
    render(
      <BookingRailInteractive
        {...BASE_PROPS}
        slots={[hoursFromNow(24 * 7)]}
      />,
    )
    expect(screen.getByText('pricing.total')).toBeTruthy()
    expect(screen.queryByText('pricing.advanceDue')).toBeNull()
    expect(screen.queryByText('pricing.balanceDue')).toBeNull()
  })
})
