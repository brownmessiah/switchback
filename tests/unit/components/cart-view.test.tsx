import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

/**
 * /cart client island (home-redesign issue 11, ADR-0021).
 *
 * The cart page lists saved lines with a per-line participants stepper
 * (shared control), remove buttons, an INR subtotal that tracks edits
 * optimistically, and a DELIBERATELY INERT "Proceed to checkout" (issue 12
 * wires the real multi-item checkout).
 */

const updateCartItemAction = vi.fn(async () => ({ ok: true as const }))
const removeFromCartAction = vi.fn(async () => ({ ok: true as const, cartCount: 0 }))
const checkoutCartAction = vi.fn()
vi.mock('@/app/(app)/cart/actions', () => ({
  updateCartItemAction: (...args: unknown[]) => updateCartItemAction(...(args as [])),
  removeFromCartAction: (...args: unknown[]) => removeFromCartAction(...(args as [])),
  checkoutCartAction: (...args: unknown[]) => checkoutCartAction(...(args as [])),
}))
vi.mock('next/script', () => ({ default: () => null }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }))
vi.mock('@/lib/toast', () => ({
  toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() },
}))

import { CartView } from '@/app/(app)/cart/cart-view'

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

const CART = {
  items: [
    {
      id: 'ci-1',
      experienceId: 'e-1',
      experienceSlug: 'rafting-rishikesh',
      experienceTitle: 'Ganga Rafting',
      slotId: 's-1',
      slotStartAtISO: '2026-08-01T06:00:00.000Z',
      variationId: null,
      variationName: null,
      participantCount: 2,
      pricePerParticipantRupees: 1500,
      lineTotalRupees: 3000,
    },
    {
      id: 'ci-2',
      experienceId: 'e-2',
      experienceSlug: 'kayak-goa',
      experienceTitle: 'Goa Kayaking',
      slotId: 's-2',
      slotStartAtISO: '2026-08-02T06:00:00.000Z',
      variationId: 'v-1',
      variationName: 'Sunset batch',
      participantCount: 4,
      pricePerParticipantRupees: 800,
      lineTotalRupees: 3200,
    },
  ],
  subtotalRupees: 6200,
}

describe('CartView', () => {
  it('lists lines with titles, variation, per-person price, and the INR subtotal', () => {
    render(<CartView initialCart={CART} />)
    expect(screen.getAllByTestId('cart-item')).toHaveLength(2)
    expect(screen.getByText('Ganga Rafting')).toBeInTheDocument()
    expect(screen.getByText(/Sunset batch/)).toBeInTheDocument()
    expect(screen.getByTestId('cart-subtotal').textContent).toBe('₹6,200')
  })

  it('stepping participants updates the line total + subtotal optimistically and persists', async () => {
    render(<CartView initialCart={CART} />)
    // First line's + button (label "Participants +", two lines → two buttons).
    fireEvent.click(screen.getAllByRole('button', { name: 'Participants +' })[0]!)

    // 3 × 1500 = 4500; subtotal 4500 + 3200 = 7700.
    expect(screen.getByTestId('cart-subtotal').textContent).toBe('₹7,700')
    await waitFor(() =>
      expect(updateCartItemAction).toHaveBeenCalledWith({
        cartItemId: 'ci-1',
        participantCount: 3,
      }),
    )
  })

  it('removing a line drops it and recomputes the subtotal', async () => {
    render(<CartView initialCart={CART} />)
    fireEvent.click(screen.getByRole('button', { name: 'Remove Ganga Rafting' }))

    await waitFor(() =>
      expect(removeFromCartAction).toHaveBeenCalledWith({ cartItemId: 'ci-1' }),
    )
    await waitFor(() =>
      expect(screen.queryByText('Ganga Rafting')).not.toBeInTheDocument(),
    )
    expect(screen.getByTestId('cart-subtotal').textContent).toBe('₹3,200')
  })

  it('"Proceed to checkout" stays disabled until the permits acknowledgement is checked (issue 12)', () => {
    render(<CartView initialCart={CART} />)
    const cta = screen.getByTestId('cart-checkout')
    expect(cta).toBeDisabled()
    fireEvent.click(screen.getByTestId('cart-permits-ack'))
    expect(cta).toBeEnabled()
  })

  it('checkout sends ONLY the idempotency key + acknowledgement (never a price)', async () => {
    checkoutCartAction.mockResolvedValueOnce({
      ok: true,
      orderId: 'o-1',
      razorpayOrderId: null,
      amountTotalRupees: 6200,
      razorpayRemainderRupees: 0,
      keyId: 'rzp_test',
    })
    render(<CartView initialCart={CART} />)
    fireEvent.click(screen.getByTestId('cart-permits-ack'))
    fireEvent.click(screen.getByTestId('cart-checkout'))
    await waitFor(() => expect(checkoutCartAction).toHaveBeenCalledTimes(1))
    const arg = checkoutCartAction.mock.calls[0]![0] as Record<string, unknown>
    expect(Object.keys(arg).sort()).toEqual(['acknowledgedPermits', 'idempotencyKey'])
    expect(arg.acknowledgedPermits).toBe(true)
    expect(typeof arg.idempotencyKey).toBe('string')
  })

  it('renders the empty state with a browse link when the cart is empty', () => {
    render(<CartView initialCart={{ items: [], subtotalRupees: 0 }} />)
    expect(screen.getByTestId('cart-empty')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Browse experiences' })).toHaveAttribute(
      'href',
      '/search',
    )
  })
})
