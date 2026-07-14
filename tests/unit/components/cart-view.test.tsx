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
vi.mock('@/app/(app)/cart/actions', () => ({
  updateCartItemAction: (...args: unknown[]) => updateCartItemAction(...(args as [])),
  removeFromCartAction: (...args: unknown[]) => removeFromCartAction(...(args as [])),
}))
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

  it('"Proceed to checkout" is present but INERT (issue 12 wires it)', () => {
    render(<CartView initialCart={CART} />)
    const cta = screen.getByTestId('cart-checkout-inert')
    expect(cta).toBeDisabled()
    expect(cta.tagName).toBe('BUTTON')
    expect(cta.getAttribute('href')).toBeNull()
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
