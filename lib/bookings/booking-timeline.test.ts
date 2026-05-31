import { describe, expect, it } from 'vitest'

import { buildBookingTimeline, type TimelineNode } from './booking-timeline'

/**
 * Pure timeline-builder for the Vendor Booking-detail "Money-State Timeline"
 * (redesign #79, direction A). It collapses the Booking lifecycle dates and
 * the `payments` rows into ONE chronological vertical rail:
 *
 *   Created → Confirmed → Advance captured → balance auto-captured at T-24h
 *           → Completed  (+ cancelled / disputed branches)
 *
 * The function is pure over its inputs so it can be unit-tested without the
 * DB or Next.js request infrastructure, and so the page Server Component can
 * render its output directly.
 */

const ts = (iso: string) => new Date(iso)

describe('buildBookingTimeline (redesign #79, direction A)', () => {
  it('renders the partial-pay Advance + T-24h balance capture as two distinct money nodes, chronologically', () => {
    const nodes = buildBookingTimeline({
      state: 'completed',
      paymentMode: 'partial_pay',
      grossRupees: 3000,
      createdAt: ts('2026-05-01T12:00:00Z'),
      confirmedAt: ts('2026-05-02T12:00:00Z'),
      completedAt: ts('2026-05-06T12:00:00Z'),
      autoCompleted: false,
      cancelledAt: null,
      payments: [
        {
          amountRupees: 750,
          captureTrigger: 'booking_create',
          capturedAt: ts('2026-05-01T12:00:00Z'),
        },
        {
          amountRupees: 2250,
          captureTrigger: 'auto_capture_t_minus_24h',
          capturedAt: ts('2026-05-05T12:00:00Z'),
        },
      ],
    })

    const keys = nodes.map((n) => n.key)
    // Lifecycle + payment events collapsed into one chronological rail.
    expect(keys).toEqual([
      'created',
      'confirmed',
      'payment-advance',
      'payment-balance',
      'completed',
    ])

    // The Advance node carries the booking-create capture amount …
    const advance = nodes.find((n) => n.key === 'payment-advance') as TimelineNode
    expect(advance.amountRupees).toBe(750)
    expect(advance.label).toMatch(/advance/i)

    // … and the balance node carries the T-24h auto-capture amount.
    const balance = nodes.find((n) => n.key === 'payment-balance') as TimelineNode
    expect(balance.amountRupees).toBe(2250)
    expect(balance.label).toMatch(/T-24h|balance/i)
  })

  it('keeps the rail in canonical lifecycle order even when payments are supplied out of order', () => {
    // A well-formed Booking: created < confirmed < advance < balance <
    // completed. Payments are intentionally supplied out of order; the rail
    // must still read top-to-bottom in canonical lifecycle order, and the
    // dated nodes must be ascending in time.
    const nodes = buildBookingTimeline({
      state: 'completed',
      paymentMode: 'partial_pay',
      grossRupees: 3000,
      createdAt: ts('2026-05-01T12:00:00Z'),
      confirmedAt: ts('2026-05-02T12:00:00Z'),
      completedAt: ts('2026-05-06T12:00:00Z'),
      autoCompleted: false,
      cancelledAt: null,
      payments: [
        // intentionally provided out of order
        {
          amountRupees: 2250,
          captureTrigger: 'auto_capture_t_minus_24h',
          capturedAt: ts('2026-05-05T12:00:00Z'),
        },
        {
          amountRupees: 750,
          captureTrigger: 'booking_create',
          capturedAt: ts('2026-05-02T13:00:00Z'),
        },
      ],
    })

    expect(nodes.map((n) => n.key)).toEqual([
      'created',
      'confirmed',
      'payment-advance',
      'payment-balance',
      'completed',
    ])

    // The dated nodes are ascending in time (the rail honours chronology
    // within the canonical lifecycle order).
    const times = nodes
      .map((n) => n.at?.getTime())
      .filter((t): t is number => typeof t === 'number')
    const sorted = [...times].sort((a, b) => a - b)
    expect(times).toEqual(sorted)
  })

  it('shows a single full-upfront capture node for a full_upfront booking', () => {
    const nodes = buildBookingTimeline({
      state: 'confirmed',
      paymentMode: 'full_upfront',
      grossRupees: 4000,
      createdAt: ts('2026-05-01T12:00:00Z'),
      confirmedAt: ts('2026-05-01T12:00:00Z'),
      completedAt: null,
      autoCompleted: false,
      cancelledAt: null,
      payments: [
        {
          amountRupees: 4000,
          captureTrigger: 'booking_create',
          capturedAt: ts('2026-05-01T12:00:00Z'),
        },
      ],
    })

    const paymentNodes = nodes.filter((n) => n.key.startsWith('payment-'))
    expect(paymentNodes).toHaveLength(1)
    expect(paymentNodes[0].amountRupees).toBe(4000)
    // No balance node for a full-upfront booking.
    expect(nodes.find((n) => n.key === 'payment-balance')).toBeUndefined()
  })

  it('appends a cancelled node (and no completed node) for a vendor-cancelled booking', () => {
    const nodes = buildBookingTimeline({
      state: 'cancelled_by_vendor',
      paymentMode: 'full_upfront',
      grossRupees: 4000,
      createdAt: ts('2026-05-01T12:00:00Z'),
      confirmedAt: ts('2026-05-02T12:00:00Z'),
      completedAt: null,
      autoCompleted: false,
      cancelledAt: ts('2026-05-03T12:00:00Z'),
      payments: [
        {
          amountRupees: 4000,
          captureTrigger: 'booking_create',
          capturedAt: ts('2026-05-01T12:00:00Z'),
        },
      ],
    })

    expect(nodes.find((n) => n.key === 'cancelled')).toBeDefined()
    expect(nodes.find((n) => n.key === 'completed')).toBeUndefined()
    // The cancelled node uses the danger status (color + icon, never color alone).
    const cancelled = nodes.find((n) => n.key === 'cancelled') as TimelineNode
    expect(cancelled.status).toBe('danger')
  })

  it('marks a disputed booking with a disputed node and never a completed node', () => {
    const nodes = buildBookingTimeline({
      state: 'disputed',
      paymentMode: 'partial_pay',
      grossRupees: 3000,
      createdAt: ts('2026-05-01T12:00:00Z'),
      confirmedAt: ts('2026-05-02T12:00:00Z'),
      completedAt: null,
      autoCompleted: false,
      cancelledAt: null,
      payments: [
        {
          amountRupees: 750,
          captureTrigger: 'booking_create',
          capturedAt: ts('2026-05-01T12:00:00Z'),
        },
        {
          amountRupees: 2250,
          captureTrigger: 'auto_capture_t_minus_24h',
          capturedAt: ts('2026-05-05T12:00:00Z'),
        },
      ],
    })

    expect(nodes.find((n) => n.key === 'disputed')).toBeDefined()
    expect(nodes.find((n) => n.key === 'completed')).toBeUndefined()
  })

  it('labels an auto-completed booking distinctly from a manual completion', () => {
    const nodes = buildBookingTimeline({
      state: 'completed',
      paymentMode: 'full_upfront',
      grossRupees: 4000,
      createdAt: ts('2026-05-01T12:00:00Z'),
      confirmedAt: ts('2026-05-02T12:00:00Z'),
      completedAt: ts('2026-05-06T12:00:00Z'),
      autoCompleted: true,
      cancelledAt: null,
      payments: [
        {
          amountRupees: 4000,
          captureTrigger: 'booking_create',
          capturedAt: ts('2026-05-01T12:00:00Z'),
        },
      ],
    })

    const completed = nodes.find((n) => n.key === 'completed') as TimelineNode
    expect(completed.label).toMatch(/auto-?completed/i)
  })
})
