/**
 * Component tests for the checkout mobile order-summary hoist
 * (FOUNDATION E — DESIGN.md §8.5 item 5 / ADR-0018).
 *
 * These cover the responsive restructure only, not the Razorpay money path
 * (that lives in the DB-integration `actions.test.ts` and the E2E suite). The
 * server actions and `next/script` are mocked so the client component renders
 * in jsdom without pulling DB / Razorpay code.
 *
 * Load-bearing invariants asserted here:
 *  - exactly ONE "Order summary" heading (no double-summary at any width) —
 *    the desktop aside owns that string; the mobile hoist uses distinct copy
 *    so the checkout E2E's strict `getByText('Order summary' | 'Total', …)`
 *    assertions keep resolving to a single node;
 *  - a condensed summary `<aside aria-label="Booking total">` precedes the
 *    stepper column in DOM order (the mobile hoist);
 *  - both summaries read the same live `count` (no duplicated state);
 *  - the participant stepper icon-buttons carry `.min-tap` (foundation A);
 *  - `data-testid="participant-count"` and the "Pay …" label are preserved.
 */

import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { CheckoutForm } from './checkout-form'

// useRouter() is called at render time — mock the navigation surface used.
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
}))

// next/script injects a real <script>; render a no-op in jsdom.
vi.mock('next/script', () => ({
  default: () => null,
}))

// The two 'use server' modules transitively import DB code — stub them.
vi.mock('./actions', () => ({
  startCheckoutAction: vi.fn(),
}))
vi.mock('./abandonment-action', () => ({
  writeAbandonmentAudit: vi.fn(),
}))

afterEach(() => {
  cleanup()
})

const BASE_PROPS = {
  experienceId: 'exp-1',
  experienceTitle: 'Sunrise Trek',
  slotId: 'slot-1',
  tripGroupId: null,
  participantCount: 2,
  maxParticipants: 6,
  priceTier12: 1000,
  priceTier35: 900,
  priceTier6: 800,
  cancellationPreset: 'flexible',
  paymentModesAllowed: ['partial_pay', 'full_upfront'],
  customerName: 'Asha',
  customerEmail: 'asha@example.com',
}

describe('CheckoutForm — mobile order-summary hoist (Foundation E)', () => {
  it('renders exactly one "Order summary" heading (no double summary)', () => {
    render(<CheckoutForm {...BASE_PROPS} />)
    expect(screen.getAllByText('Order summary')).toHaveLength(1)
  })

  it('hoists a condensed summary aside ABOVE the stepper in DOM order', () => {
    render(<CheckoutForm {...BASE_PROPS} />)

    const mobileSummary = screen.getByRole('complementary', {
      name: 'Booking total',
    })
    const stepper = screen.getByRole('list', { name: 'Checkout steps' })

    // DOM order: the hoisted summary precedes the stepper column. A node that
    // comes earlier in the document is FOLLOWING-wise positioned after the
    // reference from the summary's perspective.
    const position = mobileSummary.compareDocumentPosition(stepper)
    expect(position & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('keeps the condensed summary copy distinct from the desktop aside (no E2E strict-mode collision)', () => {
    render(<CheckoutForm {...BASE_PROPS} />)

    const mobileSummary = screen.getByRole('complementary', {
      name: 'Booking total',
    })
    // The desktop aside owns "Order summary" / "Total" / "Participants" — the
    // hoisted one must NOT repeat them, or the E2E exact-text assertions break.
    expect(within(mobileSummary).queryByText('Order summary')).toBeNull()
    expect(within(mobileSummary).queryByText('Total', { exact: true })).toBeNull()
    expect(within(mobileSummary).queryByText('Participants', { exact: true })).toBeNull()
    // It DOES restate the total figure (₹2,000 for 2 × ₹1,000 tier_1_2) — the
    // grand total ("Total due" here, "Total" in the desktop aside).
    expect(within(mobileSummary).getByText('₹2,000')).toBeInTheDocument()
  })

  it('reflects the same live count in BOTH summaries (single source of state)', () => {
    render(<CheckoutForm {...BASE_PROPS} />)

    // Two people in the tier_1_2 bracket (₹1,000) → ₹2,000 gross. The total
    // appears in BOTH the mobile hoist ("Total due") and the desktop aside
    // ("Total"), proving they read the same live `count` / `quote`.
    expect(screen.getByTestId('participant-count')).toHaveTextContent('2')
    expect(screen.getAllByText('₹2,000').length).toBeGreaterThanOrEqual(2)

    fireEvent.click(screen.getByLabelText('Add one participant'))

    // Three people cross into the tier_3_5 bracket (₹900) → ₹2,700 gross,
    // re-resolved live in both renderings.
    expect(screen.getByTestId('participant-count')).toHaveTextContent('3')
    expect(screen.getAllByText('₹2,700').length).toBeGreaterThanOrEqual(2)
  })

  it('applies the .min-tap touch-target class to both stepper icon-buttons', () => {
    render(<CheckoutForm {...BASE_PROPS} />)

    expect(screen.getByLabelText('Remove one participant')).toHaveClass('min-tap')
    expect(screen.getByLabelText('Add one participant')).toHaveClass('min-tap')
  })

  it('preserves the participant-count testid and the "Pay …" button label', () => {
    render(<CheckoutForm {...BASE_PROPS} />)

    expect(screen.getByTestId('participant-count')).toBeInTheDocument()

    // The Pay button lives on step 2 — advance, then assert the amount label.
    fireEvent.click(screen.getByRole('button', { name: /continue to payment/i }))
    // partial_pay is the default → 25% of ₹2,000 gross = ₹500.
    expect(
      screen.getByRole('button', { name: /^Pay\s/i }),
    ).toHaveTextContent('Pay ₹500')
  })
})
