import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { PayoutLedger, type PayoutLedgerRow } from '@/app/admin/payouts/payout-ledger'

// The payout Server Actions are mocked: this is a UI behavior test (co-presence
// + A4 exact-figure confirm). The action-module contract is covered by
// payouts/actions.test.ts, which we do NOT touch.
const approveSpy = vi.fn((..._args: unknown[]) => Promise.resolve({ ok: true as const }))
const holdSpy = vi.fn((..._args: unknown[]) => Promise.resolve({ ok: true as const }))
const rejectSpy = vi.fn((..._args: unknown[]) => Promise.resolve({ ok: true as const }))

vi.mock('@/app/admin/payouts/actions', () => ({
  approvePayoutAction: (bookingId: string) => approveSpy(bookingId),
  holdPayoutAction: (bookingId: string, reason: string) => holdSpy(bookingId, reason),
  rejectPayoutAction: (bookingId: string, reason: string) => rejectSpy(bookingId, reason),
}))

afterEach(() => {
  cleanup()
  approveSpy.mockClear()
  holdSpy.mockClear()
  rejectSpy.mockClear()
})

const ROW: PayoutLedgerRow = {
  bookingId: '11111111-1111-1111-1111-111111111111',
  state: 'completed',
  payoutState: 'pending',
  category: 'awaiting_approval',
  manualPayoutsRemaining: 3,
  vendorName: 'Himalayan Treks',
  expTitle: 'Sunrise Trek',
  grossRupees: 13000,
  commissionRupees: 2600,
  commissionRatePercent: '20.00',
  gstOnCommissionRupees: 468,
  tdsRupees: 13,
  tcsRupees: 65,
  netPayoutRupees: 9854,
}

describe('PayoutLedger split-view (breakdown + action co-present)', () => {
  it('shows the selected record Commission Snapshot CO-PRESENT with its action panel', async () => {
    const user = userEvent.setup()
    render(<PayoutLedger rows={[ROW]} />)

    // Select the record from the A3 queue list.
    const row = screen.getByTestId(`payout-row-${ROW.bookingId}`)
    await user.click(within(row).getByRole('button', { name: /select/i }))

    // The detail pane now shows the full Commission Snapshot...
    const detail = screen.getByTestId('ledger-detail-pane')
    expect(within(detail).getByTestId('commission-snapshot')).toBeInTheDocument()
    expect(within(detail).getByTestId('snapshot-net')).toHaveTextContent('₹9,854')
    // ...AND the approve action, on screen together.
    expect(within(detail).getByRole('button', { name: 'Approve' })).toBeInTheDocument()
  })

  it('requires the A4 exact-figure confirm before approving (no money on the inline click)', async () => {
    const user = userEvent.setup()
    render(<PayoutLedger rows={[ROW]} />)

    // The in-row Approve must NOT fire the action directly — it opens the A4
    // confirm Dialog restating the exact net figure.
    const row = screen.getByTestId(`payout-row-${ROW.bookingId}`)
    await user.click(within(row).getByRole('button', { name: 'Approve' }))
    expect(approveSpy).not.toHaveBeenCalled()

    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByTestId('confirm-money-amount')).toHaveTextContent('₹9,854')

    // Only the explicit Confirm inside the Dialog moves the money.
    await user.click(within(dialog).getByRole('button', { name: 'Approve Payout' }))
    expect(approveSpy).toHaveBeenCalledTimes(1)
    expect(approveSpy).toHaveBeenCalledWith(ROW.bookingId)
  })
})

describe('PayoutLedger queue visibility (stories 11 + 14)', () => {
  it('surfaces the awaiting-approval queue category as a visible badge', () => {
    render(<PayoutLedger rows={[ROW]} />)
    const row = screen.getByTestId(`payout-row-${ROW.bookingId}`)
    expect(within(row).getByText('Awaiting approval')).toBeInTheDocument()
  })

  it('surfaces a fund-account-blocked exception so it is never silently dropped', () => {
    const blocked: PayoutLedgerRow = {
      ...ROW,
      bookingId: '22222222-2222-2222-2222-222222222222',
      payoutState: 'approved',
      category: 'blocked_fund_account',
    }
    render(<PayoutLedger rows={[blocked]} />)
    const row = screen.getByTestId(`payout-row-${blocked.bookingId}`)
    expect(within(row).getByText('Fund account blocked')).toBeInTheDocument()
  })
})
