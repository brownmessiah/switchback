import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { CommissionRateForm } from '@/app/admin/vendors/[id]/commission-rate-form'

// #101 — Commission-rate change in the Evidence Cockpit decision rail. A
// commission change moves money on every future Booking (ADR-0008), so per the
// brief it is gated behind the shared A4 ConfirmMoneyDialog, restating the NEW
// rate before commit. updateCommissionRateAction fires ONLY from the explicit
// confirm. The existing-Booking snapshot immutability is enforced server-side
// (#22 E2E asserts it); here we assert the UI gate + the same FormData inputs.

type Result = { ok: true } | { ok: false; error: string }

const updateCommissionRateAction = vi.fn(async (_fd: FormData): Promise<Result> => ({ ok: true }))

vi.mock('@/app/admin/vendors/[id]/actions', () => ({
  updateCommissionRateAction: (fd: FormData) => updateCommissionRateAction(fd),
}))

beforeEach(() => updateCommissionRateAction.mockClear())
afterEach(() => cleanup())

async function openEditAndType(
  user: ReturnType<typeof userEvent.setup>,
  rate: string,
) {
  await user.click(screen.getByRole('button', { name: 'Edit' }))
  const input = screen.getByLabelText(/New Rate/)
  await user.clear(input)
  await user.type(input, rate)
}

describe('CommissionRateForm — A4 money confirm before changing the rate', () => {
  it('clicking Save does NOT update inline — it opens an A4 confirm', async () => {
    const user = userEvent.setup()
    render(<CommissionRateForm vendorUserId="v1" currentRate="20.00" />)
    await openEditAndType(user, '12.50')

    await user.click(screen.getByRole('button', { name: /^Save$/ }))

    expect(updateCommissionRateAction).not.toHaveBeenCalled()
    expect(screen.getByTestId('commission-rate-confirm')).toBeInTheDocument()
  })

  it('the confirm restates the NEW rate', async () => {
    const user = userEvent.setup()
    render(<CommissionRateForm vendorUserId="v1" currentRate="20.00" />)
    await openEditAndType(user, '12.5')
    await user.click(screen.getByRole('button', { name: /^Save$/ }))

    const dialog = screen.getByTestId('commission-rate-confirm')
    expect(dialog.textContent).toContain('12.5')
  })

  it('the restated figure renders in tabular-nums (DESIGN.md money rule)', async () => {
    const user = userEvent.setup()
    render(<CommissionRateForm vendorUserId="v1" currentRate="20.00" />)
    await openEditAndType(user, '12.5')
    await user.click(screen.getByRole('button', { name: /^Save$/ }))

    const figure = screen.getByTestId('commission-rate-confirm-figure')
    expect(figure).toHaveTextContent('12.5')
    expect(figure.className).toContain('tabular-nums')
  })

  it('updateCommissionRateAction fires only AFTER the explicit confirm, with the new rate', async () => {
    const user = userEvent.setup()
    render(<CommissionRateForm vendorUserId="v1" currentRate="20.00" />)
    await openEditAndType(user, '12.5')
    await user.click(screen.getByRole('button', { name: /^Save$/ }))
    expect(updateCommissionRateAction).not.toHaveBeenCalled()

    const dialog = screen.getByTestId('commission-rate-confirm')
    await user.click(within(dialog).getByRole('button', { name: 'Update Rate' }))

    expect(updateCommissionRateAction).toHaveBeenCalledTimes(1)
    const fd = updateCommissionRateAction.mock.calls[0][0]
    expect(fd.get('vendorUserId')).toBe('v1')
    // The number input normalises to '12.5'; the action coerces + .toFixed(2)s
    // it to '12.50' server-side (unchanged), so the numeric value is what matters.
    expect(Number(fd.get('commissionRate'))).toBe(12.5)
  })

  it('cancelling the confirm does NOT update the rate', async () => {
    const user = userEvent.setup()
    render(<CommissionRateForm vendorUserId="v1" currentRate="20.00" />)
    await openEditAndType(user, '12.50')
    await user.click(screen.getByRole('button', { name: /^Save$/ }))
    const dialog = screen.getByTestId('commission-rate-confirm')
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))

    expect(updateCommissionRateAction).not.toHaveBeenCalled()
  })
})
