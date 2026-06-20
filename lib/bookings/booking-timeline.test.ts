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

  it('renders a refund_reverse capture as a danger "Refund reversed" node after the captures', () => {
    // A full-upfront capture later reversed for a refund. The reverse node uses
    // the danger status and sorts after the advance within the money phase
    // (PHASE_PAYMENT + 0.7).
    const nodes = buildBookingTimeline({
      state: 'completed',
      paymentMode: 'full_upfront',
      grossRupees: 4000,
      createdAt: ts('2026-05-01T12:00:00Z'),
      confirmedAt: ts('2026-05-01T12:00:00Z'),
      completedAt: ts('2026-05-08T12:00:00Z'),
      autoCompleted: false,
      cancelledAt: null,
      payments: [
        {
          amountRupees: 4000,
          captureTrigger: 'booking_create',
          capturedAt: ts('2026-05-01T12:00:00Z'),
        },
        {
          amountRupees: 4000,
          captureTrigger: 'refund_reverse',
          capturedAt: ts('2026-05-05T12:00:00Z'),
        },
      ],
    })

    const refund = nodes.find((n) => n.key.startsWith('payment-refund-')) as TimelineNode
    expect(refund).toBeDefined()
    expect(refund.label).toMatch(/refund reversed/i)
    expect(refund.status).toBe('danger')
    expect(refund.amountRupees).toBe(4000)

    // It sorts after the advance and before the terminal completed node.
    const keys = nodes.map((n) => n.key)
    expect(keys.indexOf(refund.key)).toBeGreaterThan(keys.indexOf('payment-advance'))
    expect(keys.indexOf(refund.key)).toBeLessThan(keys.indexOf('completed'))
  })

  it('renders an unrecognised capture trigger as a generic "Payment captured" credit node', () => {
    // The `else` fallback handles manual_admin / escrow_full_capture and any
    // future capture trigger — it must still produce a money node, never drop it.
    const nodes = buildBookingTimeline({
      state: 'awaiting_completion',
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
          captureTrigger: 'manual_admin',
          capturedAt: ts('2026-05-02T12:00:00Z'),
        },
      ],
    })

    const generic = nodes.find((n) => n.key.startsWith('payment-manual_admin-')) as TimelineNode
    expect(generic).toBeDefined()
    expect(generic.label).toBe('Payment captured')
    expect(generic.status).toBe('credit')
    expect(generic.amountRupees).toBe(4000)
  })

  it('labels a customer-cancelled booking simply "Cancelled" (the non-vendor ternary arm)', () => {
    // The cancelled node's label branches on `cancelled_by_vendor`; every other
    // cancelled state (here cancelled_by_customer) uses the plain "Cancelled".
    const nodes = buildBookingTimeline({
      state: 'cancelled_by_customer',
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

    const cancelled = nodes.find((n) => n.key === 'cancelled') as TimelineNode
    expect(cancelled).toBeDefined()
    expect(cancelled.label).toBe('Cancelled')
    expect(cancelled.label).not.toMatch(/vendor/i)
  })

  it('treats the cancelled_post_experience state as a cancelled terminal node', () => {
    // The third member of CANCELLED_STATES — exercises the Set membership arm
    // for a state distinct from the two already covered.
    const nodes = buildBookingTimeline({
      state: 'cancelled_post_experience',
      paymentMode: 'full_upfront',
      grossRupees: 4000,
      createdAt: ts('2026-05-01T12:00:00Z'),
      confirmedAt: ts('2026-05-02T12:00:00Z'),
      completedAt: null,
      autoCompleted: false,
      cancelledAt: ts('2026-05-10T12:00:00Z'),
      payments: [],
    })

    expect(nodes.find((n) => n.key === 'cancelled')).toBeDefined()
    expect(nodes.find((n) => n.key === 'completed')).toBeUndefined()
  })

  it('orders two captures with the identical timestamp by their input index (stable tie-break)', () => {
    // Two booking-phase-adjacent captures captured at the EXACT same instant.
    // The advance (PHASE_PAYMENT) and a generic capture (PHASE_PAYMENT + 0.6)
    // differ in phase, so to force the `at === bt` tie-break we need two nodes
    // in the SAME phase. The advance + balance differ in phase too; the cleanest
    // same-phase, same-time pair is two generic captures.
    const sameInstant = ts('2026-05-02T12:00:00Z')
    const nodes = buildBookingTimeline({
      state: 'awaiting_completion',
      paymentMode: 'full_upfront',
      grossRupees: 4000,
      createdAt: ts('2026-05-01T12:00:00Z'),
      confirmedAt: null,
      completedAt: null,
      autoCompleted: false,
      cancelledAt: null,
      payments: [
        { amountRupees: 1000, captureTrigger: 'manual_admin', capturedAt: sameInstant },
        { amountRupees: 2000, captureTrigger: 'escrow_full_capture', capturedAt: sameInstant },
      ],
    })

    const generics = nodes.filter((n) => n.key.startsWith('payment-'))
    expect(generics).toHaveLength(2)
    // Identical phase + identical timestamp ⇒ original input order preserved:
    // manual_admin (₹1000) was supplied first, so it sorts first.
    expect(generics[0]?.amountRupees).toBe(1000)
    expect(generics[1]?.amountRupees).toBe(2000)
  })

  it('sorts an undated (scheduled) capture after a dated one within the same phase', () => {
    // A balance capture whose capturedAt is null (scheduled, not yet captured)
    // and another null-dated generic capture: dated nodes sort before undated
    // ones; among two undated same-phase nodes, input index decides. This
    // exercises the at==null / bt==null / both-null tie-break arms.
    const nodes = buildBookingTimeline({
      state: 'confirmed',
      paymentMode: 'partial_pay',
      grossRupees: 3000,
      createdAt: ts('2026-05-01T12:00:00Z'),
      confirmedAt: ts('2026-05-01T12:00:00Z'),
      completedAt: null,
      autoCompleted: false,
      cancelledAt: null,
      payments: [
        // Advance is undated (scheduled); balance dated. The dated balance must
        // sort before the undated advance when their effective sort time differs,
        // but the advance is an earlier phase — so to isolate the date tie-break
        // we use two generic captures in the same phase: one dated, one undated.
        { amountRupees: 500, captureTrigger: 'escrow_full_capture', capturedAt: null },
        {
          amountRupees: 1500,
          captureTrigger: 'manual_admin',
          capturedAt: ts('2026-05-02T12:00:00Z'),
        },
      ],
    })

    const generics = nodes.filter((n) => n.key.startsWith('payment-'))
    expect(generics).toHaveLength(2)
    // Same phase (+0.6): the DATED capture (₹1500) sorts before the UNDATED one (₹500).
    expect(generics[0]?.amountRupees).toBe(1500)
    expect(generics[0]?.at).toBeInstanceOf(Date)
    expect(generics[1]?.amountRupees).toBe(500)
    expect(generics[1]?.at).toBeNull()
  })

  it('orders two dated same-phase captures by ascending timestamp (chronology tie-break)', () => {
    // Two generic captures share the same phase (+0.6). Both are dated with
    // DIFFERENT times and supplied newest-first; the rail must reorder them so
    // the earlier capture reads first (the `return at - bt` chronology arm).
    const nodes = buildBookingTimeline({
      state: 'awaiting_completion',
      paymentMode: 'full_upfront',
      grossRupees: 4000,
      createdAt: ts('2026-05-01T12:00:00Z'),
      confirmedAt: null,
      completedAt: null,
      autoCompleted: false,
      cancelledAt: null,
      payments: [
        // Supplied newest-first on purpose.
        {
          amountRupees: 2000,
          captureTrigger: 'manual_admin',
          capturedAt: ts('2026-05-04T12:00:00Z'),
        },
        {
          amountRupees: 1000,
          captureTrigger: 'escrow_full_capture',
          capturedAt: ts('2026-05-02T12:00:00Z'),
        },
      ],
    })

    const generics = nodes.filter((n) => n.key.startsWith('payment-'))
    expect(generics).toHaveLength(2)
    // Earlier capture (₹1000 @ 05-02) sorts before the later one (₹2000 @ 05-04).
    expect(generics[0]?.amountRupees).toBe(1000)
    expect(generics[1]?.amountRupees).toBe(2000)
  })

  it('orders two undated same-phase captures by their input index (both-null tie-break)', () => {
    const nodes = buildBookingTimeline({
      state: 'confirmed',
      paymentMode: 'full_upfront',
      grossRupees: 3000,
      createdAt: ts('2026-05-01T12:00:00Z'),
      confirmedAt: null,
      completedAt: null,
      autoCompleted: false,
      cancelledAt: null,
      payments: [
        { amountRupees: 700, captureTrigger: 'manual_admin', capturedAt: null },
        { amountRupees: 800, captureTrigger: 'escrow_full_capture', capturedAt: null },
      ],
    })

    const generics = nodes.filter((n) => n.key.startsWith('payment-'))
    expect(generics).toHaveLength(2)
    // Both undated, same phase ⇒ original input order.
    expect(generics[0]?.amountRupees).toBe(700)
    expect(generics[1]?.amountRupees).toBe(800)
  })
})
