import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { CheckoutForm } from '@/app/(app)/checkout/checkout-form'

// ─────────────────────────────────────────────────────────────────────────────
// Issue #15 — the checkout form must MOUNT the Razorpay pay-sheet and gate the
// confirmation page on a real payment success. The prior bug pushed straight to
// /confirmation right after startCheckoutAction, never collecting payment.
//
// These component tests pin the three money-path branches:
//   1. charge   — amountRupees>0 + orderId → open Razorpay, success handler →
//                 push to confirmation with the right order_id / amount / key.
//   2. dismiss  — modal.ondismiss → writeAbandonmentAudit, NO confirmation push
//                 (never a false success).
//   3. wallet   — amountRupees 0, orderId null → push to confirmation directly,
//                 Razorpay NEVER constructed (the wallet funded it, ADR-0004).
// ─────────────────────────────────────────────────────────────────────────────

// ── Router mock ──────────────────────────────────────────────────────────────
const push = vi.fn()
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push }),
}))

// ── next/script mock — render nothing; the test supplies window.Razorpay. ─────
vi.mock('next/script', () => ({
  default: () => null,
}))

// ── Server action mocks ──────────────────────────────────────────────────────
const startCheckoutAction = vi.fn<(input: unknown) => Promise<unknown>>()
vi.mock('@/app/(app)/checkout/actions', () => ({
  startCheckoutAction: (input: unknown) => startCheckoutAction(input),
}))

const writeAbandonmentAudit = vi.fn<(bookingId: string) => Promise<void>>(
  async () => undefined,
)
vi.mock('@/app/(app)/checkout/abandonment-action', () => ({
  writeAbandonmentAudit: (bookingId: string) => writeAbandonmentAudit(bookingId),
}))

// A real UUID — booking-create parses idempotencyKey with z.string().uuid().
const BOOKING_ID = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'
const SLOT_ID = 'cccccccc-cccc-cccc-cccc-cccccccccccc'
const ORDER_ID = 'order_test_123'

const baseProps = {
  experienceId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  experienceTitle: 'Sunset Kayaking',
  slotId: SLOT_ID,
  // Group-size tiers (#12): count=2 falls in the 1-2 bracket → ₹2000/person,
  // gross ₹4000, 25% advance ₹1000 — matching the mocked startCheckoutAction
  // amountRupees below. The displayed quote is derived from these; the charge
  // itself comes from the server action result, not the client quote.
  participantCount: 2,
  maxParticipants: 8,
  priceTier12: 2000,
  priceTier35: 1800,
  priceTier6: 1600,
  cancellationPreset: 'flexible',
  paymentModesAllowed: ['partial_pay', 'full_upfront'],
  customerName: 'Asha Rao',
  customerEmail: 'asha@example.com',
}

/**
 * Install a window.Razorpay stub.
 * @param mode 'success' fires options.handler synchronously on .open();
 *             'dismiss' fires options.modal.ondismiss instead.
 * Returns a record capturing the constructor options + open() call count.
 */
function installRazorpay(mode: 'success' | 'dismiss') {
  const captured: { options: Record<string, unknown> | null; opened: number } = {
    options: null,
    opened: 0,
  }
  // @ts-expect-error — test stub of the global injected by checkout.js
  window.Razorpay = function RazorpayMock(options: Record<string, unknown>) {
    captured.options = options
    return {
      open() {
        captured.opened += 1
        if (mode === 'success') {
          const handler = options.handler as (r: {
            razorpay_payment_id: string
            razorpay_order_id: string
            razorpay_signature: string
          }) => void
          handler({
            razorpay_payment_id: 'pay_test_1',
            razorpay_order_id: (options.order_id as string) ?? 'order_test_1',
            razorpay_signature: 'sig_test_1',
          })
        } else {
          const modal = options.modal as { ondismiss: () => void | Promise<void> }
          void modal.ondismiss()
        }
      },
      on() {},
    }
  }
  return captured
}

async function advanceToPay(user: ReturnType<typeof userEvent.setup>) {
  // Pay lives on STEP 2 — advance past "Your details" first.
  await user.click(screen.getByRole('button', { name: /continue to payment/i }))
  return screen.getByRole('button', { name: /^Pay\s/i })
}

beforeEach(() => {
  push.mockClear()
  startCheckoutAction.mockReset()
  writeAbandonmentAudit.mockClear()
  // @ts-expect-error — reset the global between tests
  delete window.Razorpay
})

afterEach(() => {
  cleanup()
})

describe('CheckoutForm — Razorpay pay-sheet (#15)', () => {
  it('1. charge: opens Razorpay with order_id/amount/key, success handler pushes to confirmation', async () => {
    startCheckoutAction.mockResolvedValue({
      ok: true,
      bookingId: BOOKING_ID,
      orderId: ORDER_ID,
      amountRupees: 1000, // 25% advance of 4000
      keyId: 'rzp_test_key',
      walletApplied: { razorpayRemainderRupees: 1000 },
    })
    const captured = installRazorpay('success')

    const user = userEvent.setup()
    render(<CheckoutForm {...baseProps} />)

    const payButton = await advanceToPay(user)
    await user.click(payButton)

    // Razorpay was constructed with the correct money-path options.
    expect(captured.opened).toBe(1)
    expect(captured.options).toMatchObject({
      key: 'rzp_test_key',
      amount: 1000 * 100,
      currency: 'INR',
      order_id: ORDER_ID,
    })
    // prefill carries the signed-in customer identity.
    expect(captured.options?.prefill).toMatchObject({
      name: 'Asha Rao',
      email: 'asha@example.com',
    })

    // Success handler is the ONLY path to confirmation.
    expect(push).toHaveBeenCalledWith(`/bookings/${BOOKING_ID}/confirmation`)
    expect(writeAbandonmentAudit).not.toHaveBeenCalled()
  })

  it('2. dismiss: modal.ondismiss writes the abandonment audit and does NOT push (no false confirmation)', async () => {
    startCheckoutAction.mockResolvedValue({
      ok: true,
      bookingId: BOOKING_ID,
      orderId: ORDER_ID,
      amountRupees: 1000,
      keyId: 'rzp_test_key',
      walletApplied: { razorpayRemainderRupees: 1000 },
    })
    installRazorpay('dismiss')

    const user = userEvent.setup()
    render(<CheckoutForm {...baseProps} />)

    const payButton = await advanceToPay(user)
    await user.click(payButton)

    expect(writeAbandonmentAudit).toHaveBeenCalledWith(BOOKING_ID)
    // CRITICAL money-path invariant: a dismissed sheet never reaches confirmation.
    expect(push).not.toHaveBeenCalled()
  })

  it('3. wallet-covered: orderId null + amountRupees 0 pushes to confirmation directly, never constructs Razorpay', async () => {
    startCheckoutAction.mockResolvedValue({
      ok: true,
      bookingId: BOOKING_ID,
      orderId: null,
      amountRupees: 0,
      keyId: 'rzp_test_key',
      walletApplied: { razorpayRemainderRupees: 0 },
    })
    const captured = installRazorpay('success')

    const user = userEvent.setup()
    render(<CheckoutForm {...baseProps} />)

    const payButton = await advanceToPay(user)
    await user.click(payButton)

    expect(push).toHaveBeenCalledWith(`/bookings/${BOOKING_ID}/confirmation`)
    // The wallet funded it — no Razorpay charge, no sheet.
    expect(captured.opened).toBe(0)
    expect(captured.options).toBeNull()
  })

  it('failure: startCheckoutAction !ok surfaces the message and never navigates', async () => {
    startCheckoutAction.mockResolvedValue({
      ok: false,
      error: 'slot_unavailable',
      message: 'This slot is no longer available.',
    })
    installRazorpay('success')

    const user = userEvent.setup()
    render(<CheckoutForm {...baseProps} />)

    const payButton = await advanceToPay(user)
    await user.click(payButton)

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'This slot is no longer available.',
    )
    expect(push).not.toHaveBeenCalled()
  })

  it('passes a real UUID idempotencyKey so the booking-create uuid() parse passes', async () => {
    startCheckoutAction.mockResolvedValue({
      ok: true,
      bookingId: BOOKING_ID,
      orderId: ORDER_ID,
      amountRupees: 1000,
      keyId: 'rzp_test_key',
      walletApplied: { razorpayRemainderRupees: 1000 },
    })
    installRazorpay('success')

    const user = userEvent.setup()
    render(<CheckoutForm {...baseProps} />)

    const payButton = await advanceToPay(user)
    await user.click(payButton)

    const arg = startCheckoutAction.mock.calls[0][0] as { idempotencyKey: string }
    expect(arg.idempotencyKey).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    )
  })
})
