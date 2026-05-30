import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { ConfirmMoneyDialog } from '@/app/admin/_components/confirm-money-dialog'

afterEach(() => {
  cleanup()
})

// A4 exact-figure confirm Dialog (DESIGN.md §4 A4): every money-moving admin
// action must restate the EXACT ₹ figure being approved/held/rejected before
// the operator confirms. A misclick must NOT move money — the action only
// fires from the dialog's explicit Confirm, never inline.

describe('ConfirmMoneyDialog (A4 exact-figure confirm)', () => {
  it('restates the exact rupee figure in tabular-nums before confirm', () => {
    render(
      <ConfirmMoneyDialog
        open
        onOpenChange={() => {}}
        title="Approve Payout"
        actionLabel="Approve Payout"
        amountRupees={17600}
        onConfirm={() => {}}
      />,
    )

    // The exact figure is restated, formatted en-IN with the rupee glyph.
    const figure = screen.getByTestId('confirm-money-amount')
    expect(figure).toHaveTextContent('₹17,600')
    // All money is tabular (DESIGN.md §1.3 / §2.2).
    expect(figure.className).toContain('tabular-nums')
  })

  it('only fires onConfirm from the explicit Confirm control (no money on misclick)', async () => {
    const user = userEvent.setup()
    const onConfirm = vi.fn()
    render(
      <ConfirmMoneyDialog
        open
        onOpenChange={() => {}}
        title="Approve Payout"
        actionLabel="Approve Payout"
        amountRupees={17600}
        onConfirm={onConfirm}
      />,
    )

    // Opening the dialog must not have moved money.
    expect(onConfirm).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: 'Approve Payout' }))
    expect(onConfirm).toHaveBeenCalledTimes(1)
  })

  it('renders a Cancel control that does not confirm', async () => {
    const user = userEvent.setup()
    const onConfirm = vi.fn()
    render(
      <ConfirmMoneyDialog
        open
        onOpenChange={() => {}}
        title="Reject Refund"
        actionLabel="Reject Refund"
        amountRupees={5000}
        onConfirm={onConfirm}
      />,
    )

    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onConfirm).not.toHaveBeenCalled()
  })
})
