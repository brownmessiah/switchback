import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Issue 24 — checkout action toasts. The Razorpay pay-sheet money path is
 * UNCHANGED (capture/confirmation logic is owned by checkout-payment.test.tsx);
 * here we only assert the UI-feedback toasts ADD on top:
 *   - booking started (Pay clicked)   → info toast
 *   - payment failed / not completed   → error toast (sheet dismissed)
 *   - start error (action !ok)         → error toast (existing inline alert kept)
 */

const { toast, push } = vi.hoisted(() => ({
  toast: Object.assign(vi.fn(), {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
  }),
  push: vi.fn(),
}))
vi.mock('@/lib/toast', () => ({ toast }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }))
vi.mock('next/script', () => ({ default: () => null }))

const startCheckoutAction = vi.fn<(input: unknown) => Promise<unknown>>()
vi.mock('@/app/(app)/checkout/actions', () => ({
  startCheckoutAction: (input: unknown) => startCheckoutAction(input),
}))
const writeAbandonmentAudit = vi.fn(async () => undefined)
vi.mock('@/app/(app)/checkout/abandonment-action', () => ({
  writeAbandonmentAudit: () => writeAbandonmentAudit(),
}))

import { CheckoutForm } from '@/app/(app)/checkout/checkout-form'

const BOOKING_ID = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'
const SLOT_ID = 'cccccccc-cccc-cccc-cccc-cccccccccccc'

const baseProps = {
  experienceId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  experienceTitle: 'Sunset Kayaking',
  slotId: SLOT_ID,
  participantCount: 2,
  maxParticipants: 8,
  priceTier12: 2000,
  priceTier35: 1800,
  priceTier6: 1600,
  cancellationPreset: 'flexible',
  paymentModesAllowed: ['partial_pay', 'full_upfront'],
  customerName: 'Asha Rao',
  customerEmail: 'asha@example.com',
  toastLabels: {
    bookingStarted: 'Starting your booking',
    paymentFailed: 'Payment was not completed. You have not been charged.',
    startError: 'Something went wrong. Please try again.',
  },
}

function installRazorpay(mode: 'success' | 'dismiss') {
  // @ts-expect-error — test stub of the global injected by checkout.js
  window.Razorpay = function RazorpayMock(options: Record<string, unknown>) {
    return {
      open() {
        if (mode === 'dismiss') {
          const modal = options.modal as { ondismiss: () => void | Promise<void> }
          void modal.ondismiss()
        }
      },
      on() {},
    }
  }
}

async function clickPay(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: /continue to payment/i }))
  await user.click(screen.getByRole('button', { name: /^Pay\s/i }))
}

beforeEach(() => {
  push.mockClear()
  toast.info.mockClear()
  toast.error.mockClear()
  startCheckoutAction.mockReset()
  writeAbandonmentAudit.mockClear()
  // @ts-expect-error — reset global between tests
  delete window.Razorpay
})

afterEach(() => {
  cleanup()
})

describe('CheckoutForm — action toasts (issue 24)', () => {
  it('fires an info toast when the booking is started (Pay clicked)', async () => {
    startCheckoutAction.mockResolvedValue({
      ok: true,
      bookingId: BOOKING_ID,
      orderId: 'order_1',
      amountRupees: 1000,
      keyId: 'rzp_test_key',
    })
    installRazorpay('success')
    const user = userEvent.setup()
    render(<CheckoutForm {...baseProps} />)

    await clickPay(user)

    expect(toast.info).toHaveBeenCalledWith('Starting your booking')
  })

  it('fires an error toast when the Razorpay sheet is dismissed without paying', async () => {
    startCheckoutAction.mockResolvedValue({
      ok: true,
      bookingId: BOOKING_ID,
      orderId: 'order_1',
      amountRupees: 1000,
      keyId: 'rzp_test_key',
    })
    installRazorpay('dismiss')
    const user = userEvent.setup()
    render(<CheckoutForm {...baseProps} />)

    await clickPay(user)

    expect(toast.error).toHaveBeenCalledWith(
      'Payment was not completed. You have not been charged.',
    )
    // Money-path invariant preserved: a dismissed sheet never confirms.
    expect(push).not.toHaveBeenCalled()
  })

  it('fires an error toast when startCheckoutAction returns !ok', async () => {
    startCheckoutAction.mockResolvedValue({
      ok: false,
      error: 'slot_unavailable',
      message: 'This slot is no longer available.',
    })
    installRazorpay('success')
    const user = userEvent.setup()
    render(<CheckoutForm {...baseProps} />)

    await clickPay(user)

    expect(toast.error).toHaveBeenCalledWith('This slot is no longer available.')
    // Existing inline alert is kept too.
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'This slot is no longer available.',
    )
  })
})
