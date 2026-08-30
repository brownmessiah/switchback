import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { GrantCreditForm } from '@/app/admin/loyalty/grant-credit-form'

// #96 loyalty grant form. A manual grant CREDITS real money to a Customer's
// Wallet, so the action is gated behind the shared A4 ConfirmMoneyDialog
// (DESIGN.md §4 A4): clicking "Grant Credit" opens a confirm that RESTATES the
// EXACT ₹ figure being granted AND which bucket it lands in — the Switchback
// credit bucket (closed-loop, WITH expiry per ADR-0004), NOT the Refund balance
// — before the operator commits. A misclick must NOT grant money: adminGrantCredit
// only fires from the explicit Confirm inside the dialog, never inline.
//
// We mock adminGrantCredit so the form is unit-tested in isolation and assert
// it is called with the SAME FormData inputs the unchanged action expects.

type Result =
  | { ok: true; walletTransactionId: string }
  | { ok: false; error: string }

const adminGrantCredit = vi.fn(
  async (_formData: FormData): Promise<Result> => ({
    ok: true,
    walletTransactionId: 'wtx_1',
  }),
)

vi.mock('@/app/admin/loyalty/actions', () => ({
  adminGrantCredit: (formData: FormData) => adminGrantCredit(formData),
}))

beforeEach(() => {
  adminGrantCredit.mockClear()
})

afterEach(() => {
  cleanup()
})

async function fillForm(
  user: ReturnType<typeof userEvent.setup>,
  { amount = '750', bucket = 'outvers_credit' }: { amount?: string; bucket?: string } = {},
) {
  await user.type(screen.getByLabelText('User ID'), 'u_seed_customer_loyalty')
  await user.clear(screen.getByLabelText(/Amount/))
  await user.type(screen.getByLabelText(/Amount/), amount)
  await user.selectOptions(screen.getByLabelText('Balance Type'), bucket)
  await user.type(screen.getByLabelText('Reason'), 'goodwill')
}

describe('GrantCreditForm — A4 money confirm before granting credit', () => {
  it('clicking Grant Credit does NOT grant money inline — it opens an A4 confirm', async () => {
    const user = userEvent.setup()
    render(<GrantCreditForm />)
    await fillForm(user)

    await user.click(screen.getByRole('button', { name: 'Grant Credit' }))
    expect(adminGrantCredit).not.toHaveBeenCalled()
  })

  it('the confirm restates the EXACT ₹ figure in tabular-nums', async () => {
    const user = userEvent.setup()
    render(<GrantCreditForm />)
    await fillForm(user, { amount: '750' })

    await user.click(screen.getByRole('button', { name: 'Grant Credit' }))
    const figure = screen.getByTestId('confirm-money-amount')
    expect(figure).toHaveTextContent('₹750')
    expect(figure.className).toContain('tabular-nums')
  })

  it('the confirm names the Switchback credit bucket WITH expiry, NOT the Refund balance', async () => {
    const user = userEvent.setup()
    render(<GrantCreditForm />)
    await fillForm(user, { bucket: 'outvers_credit' })

    await user.click(screen.getByRole('button', { name: 'Grant Credit' }))
    const dialog = screen.getByTestId('grant-credit-confirm')
    expect(dialog.textContent).toMatch(/Switchback credit/i)
    expect(dialog.textContent).toMatch(/expir/i)
    expect(dialog.textContent).not.toMatch(/Refund balance/i)
  })

  it('the confirm names the Refund balance bucket (no expiry) when that bucket is chosen', async () => {
    const user = userEvent.setup()
    render(<GrantCreditForm />)
    await fillForm(user, { bucket: 'refund_balance' })

    await user.click(screen.getByRole('button', { name: 'Grant Credit' }))
    const dialog = screen.getByTestId('grant-credit-confirm')
    expect(dialog.textContent).toMatch(/Refund balance/i)
  })

  it('only fires adminGrantCredit AFTER the explicit confirm, with the same FormData inputs', async () => {
    const user = userEvent.setup()
    render(<GrantCreditForm />)
    await fillForm(user, { amount: '750', bucket: 'outvers_credit' })

    await user.click(screen.getByRole('button', { name: 'Grant Credit' }))
    expect(adminGrantCredit).not.toHaveBeenCalled()

    const dialog = screen.getByTestId('grant-credit-confirm')
    await user.click(within(dialog).getByRole('button', { name: 'Grant Credit' }))

    expect(adminGrantCredit).toHaveBeenCalledTimes(1)
    const fd = adminGrantCredit.mock.calls[0][0]
    expect(fd.get('userId')).toBe('u_seed_customer_loyalty')
    expect(fd.get('amountRupees')).toBe('750')
    expect(fd.get('balanceType')).toBe('outvers_credit')
    expect(fd.get('reason')).toBe('goodwill')
  })

  it('cancelling the confirm does NOT grant money', async () => {
    const user = userEvent.setup()
    render(<GrantCreditForm />)
    await fillForm(user)

    await user.click(screen.getByRole('button', { name: 'Grant Credit' }))
    const dialog = screen.getByTestId('grant-credit-confirm')
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    expect(adminGrantCredit).not.toHaveBeenCalled()
  })

  it('shows the inline success state after a successful grant', async () => {
    const user = userEvent.setup()
    render(<GrantCreditForm />)
    await fillForm(user)

    await user.click(screen.getByRole('button', { name: 'Grant Credit' }))
    const dialog = screen.getByTestId('grant-credit-confirm')
    await user.click(within(dialog).getByRole('button', { name: 'Grant Credit' }))

    expect(await screen.findByText(/Credit granted\. Transaction:/)).toBeInTheDocument()
  })
})
