import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

const mockStartCheckout = vi.fn(async (_input: Record<string, unknown>) => ({ ok: true as const, bookingId: 'b1', orderId: null, amountRupees: 0, keyId: '', walletApplied: {} }))
const mockPush = vi.fn()

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: mockPush }) }))
vi.mock('@/app/(app)/checkout/actions', () => ({ startCheckoutAction: (input: Record<string, unknown>) => mockStartCheckout(input) }))

import { CheckoutForm } from '@/app/(app)/checkout/checkout-form'

afterEach(() => {
  cleanup()
  mockStartCheckout.mockClear()
  mockPush.mockClear()
})

const baseProps = {
  experienceId: 'e1',
  experienceTitle: 'Rafting',
  slotId: '11111111-1111-4111-8111-111111111111',
  participantCount: 2,
  maxParticipants: 5,
  priceTier12: 1500,
  priceTier35: 1300,
  priceTier6: 1100,
  cancellationPreset: 'flexible',
  paymentModesAllowed: ['full_upfront', 'partial_pay'],
  customerName: 'Test',
  customerEmail: 't@example.com',
}

describe('CheckoutForm participant stepper (parity-catchup/12)', () => {
  it('renders the initial count + total from the 1-2 bracket', () => {
    render(<CheckoutForm {...baseProps} />)
    expect(screen.getByTestId('participant-count')).toHaveTextContent('2')
    // total = 1500 × 2 — appears in both the mobile hoist + desktop aside
    // summaries (both in the jsdom DOM; one visible per viewport).
    expect(screen.getAllByText('₹3,000').length).toBeGreaterThan(0)
  })

  it('incrementing past 2 crosses into the 3-5 bracket and re-resolves the total live', () => {
    render(<CheckoutForm {...baseProps} />)
    fireEvent.click(screen.getByRole('button', { name: /add one participant/i }))
    expect(screen.getByTestId('participant-count')).toHaveTextContent('3')
    // bracket switched to ₹1,300/person → total 1300 × 3 = ₹3,900 (in both
    // the mobile hoist + desktop aside summaries under jsdom).
    expect(screen.getAllByText('₹3,900').length).toBeGreaterThan(0)
  })

  it('bounds the count to the slot remaining capacity (increment disabled at max)', () => {
    render(<CheckoutForm {...baseProps} participantCount={5} maxParticipants={5} />)
    expect(screen.getByTestId('participant-count')).toHaveTextContent('5')
    expect(screen.getByRole('button', { name: /add one participant/i })).toBeDisabled()
  })

  it('cannot decrement below 1', () => {
    render(<CheckoutForm {...baseProps} participantCount={1} maxParticipants={5} />)
    expect(screen.getByRole('button', { name: /remove one participant/i })).toBeDisabled()
  })

  it('passes the chosen count into the checkout action', async () => {
    render(<CheckoutForm {...baseProps} />)
    // 2 → 3
    fireEvent.click(screen.getByRole('button', { name: /add one participant/i }))
    // details → payment
    fireEvent.click(screen.getByRole('button', { name: /continue to payment/i }))
    // pay
    fireEvent.click(screen.getByRole('button', { name: /^pay /i }))
    await waitFor(() => expect(mockStartCheckout).toHaveBeenCalledTimes(1))
    expect(mockStartCheckout.mock.calls[0][0]).toMatchObject({ participantCount: 3 })
  })
})
