import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { RefundLedger, type RefundLedgerRow } from '@/app/admin/refunds/refund-ledger'

const approveSpy = vi.fn((..._args: unknown[]) => Promise.resolve({ ok: true as const }))
const rejectSpy = vi.fn((..._args: unknown[]) => Promise.resolve({ ok: true as const }))

vi.mock('@/app/admin/refunds/actions', () => ({
  approveRefundAction: (id: string, amount: number) => approveSpy(id, amount),
  rejectRefundAction: (id: string, reason: string) => rejectSpy(id, reason),
}))

afterEach(() => {
  cleanup()
  approveSpy.mockClear()
  rejectSpy.mockClear()
})

const ROW: RefundLedgerRow = {
  id: '22222222-2222-2222-2222-222222222222',
  state: 'pending',
  amount: 5000,
  reason: 'customer_request',
  destination: 'refund_balance',
  bookingId: 'abcdef1234567890',
  customerEmail: 'cust@example.com',
  notes: null,
  createdAtLabel: '12 May 2026',
}

describe('RefundLedger split-view (breakdown + action co-present)', () => {
  it('shows the selected refund breakdown CO-PRESENT with its action panel', async () => {
    const user = userEvent.setup()
    render(<RefundLedger rows={[ROW]} />)

    const row = screen.getByTestId(`refund-row-${ROW.id}`)
    await user.click(within(row).getByRole('button', { name: /select/i }))

    const detail = screen.getByTestId('ledger-detail-pane')
    // The refund amount + its target Wallet bucket are shown in the detail...
    expect(within(detail).getByTestId('refund-amount')).toHaveTextContent('₹5,000')
    expect(within(detail).getByText(/Refund balance/i)).toBeInTheDocument()
    // ...co-present with the approve action.
    expect(within(detail).getByRole('button', { name: 'Approve' })).toBeInTheDocument()
  })

  it('approve opens the A4 exact-figure confirm restating the refund ₹ (editable amount preserved)', async () => {
    const user = userEvent.setup()
    render(<RefundLedger rows={[ROW]} />)

    const row = screen.getByTestId(`refund-row-${ROW.id}`)
    await user.click(within(row).getByRole('button', { name: 'Approve' }))
    expect(approveSpy).not.toHaveBeenCalled()

    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByRole('heading', { name: 'Approve Refund' })).toBeInTheDocument()
    // The exact figure being approved is restated.
    expect(within(dialog).getByTestId('confirm-money-amount')).toHaveTextContent('₹5,000')

    await user.click(within(dialog).getByRole('button', { name: 'Approve Refund' }))
    expect(approveSpy).toHaveBeenCalledTimes(1)
    expect(approveSpy).toHaveBeenCalledWith(ROW.id, 5000)
  })
})
