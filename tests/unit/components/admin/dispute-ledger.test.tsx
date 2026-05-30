import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { DisputeLedger, type DisputeLedgerRow } from '@/app/admin/disputes/dispute-ledger'

const resolveCompletedSpy = vi.fn((..._args: unknown[]) =>
  Promise.resolve({ ok: true as const }),
)
const resolveCancelledSpy = vi.fn((..._args: unknown[]) =>
  Promise.resolve({ ok: true as const }),
)

vi.mock('@/app/admin/disputes/actions', () => ({
  resolveAsCompletedAction: (
    bookingId: string,
    notes: string,
    partialRefundRupees?: number,
    adjustedCommissionRate?: string,
  ) => resolveCompletedSpy(bookingId, notes, partialRefundRupees, adjustedCommissionRate),
  resolveAsCancelledAction: (bookingId: string, notes: string) =>
    resolveCancelledSpy(bookingId, notes),
}))

afterEach(() => {
  cleanup()
  resolveCompletedSpy.mockClear()
  resolveCancelledSpy.mockClear()
})

const ROW: DisputeLedgerRow = {
  id: '33333333-3333-3333-3333-333333333333',
  state: 'disputed',
  participantCount: 2,
  grossRupees: 9000,
  commissionRatePercent: '20.00',
  paymentMode: 'full_upfront',
  payoutState: 'held',
  confirmedAt: new Date('2026-05-01T00:00:00Z'),
  customerName: 'Alice Customer',
  customerEmail: 'alice@test.com',
  experienceTitle: 'Paragliding',
  vendorBusinessName: 'Sky High',
  slotStart: new Date('2026-06-15T09:00:00Z'),
}

describe('DisputeLedger split-view (#93, variant B)', () => {
  it('shows the selected dispute Booking context CO-PRESENT with its resolve action panel', async () => {
    const user = userEvent.setup()
    render(<DisputeLedger rows={[ROW]} />)

    // Select the dispute row.
    const row = document.querySelector(
      `tr[data-booking-id="${ROW.id}"]`,
    ) as HTMLElement
    expect(row).not.toBeNull()
    await user.click(within(row).getByRole('button', { name: /select/i }))

    const detail = screen.getByTestId('ledger-detail-pane')
    // Booking context (Experience + gross) and the resolve action are co-present.
    expect(within(detail).getByText('Paragliding')).toBeInTheDocument()
    expect(within(detail).getByText('₹9,000')).toBeInTheDocument()
    expect(
      within(detail).getByRole('button', { name: /Resolve as Completion/i }),
    ).toBeInTheDocument()
  })

  it('Resolve as Completion opens an A4 confirm restating the partial refund ₹ before commit', async () => {
    const user = userEvent.setup()
    render(<DisputeLedger rows={[ROW]} />)

    const row = document.querySelector(`tr[data-booking-id="${ROW.id}"]`) as HTMLElement
    await user.click(within(row).getByRole('button', { name: /select/i }))
    const detail = screen.getByTestId('ledger-detail-pane')

    // Open the panel resolve-as-completion flow + supply notes + a partial refund.
    await user.click(within(detail).getByRole('button', { name: /Resolve as Completion/i }))
    const dialog = await screen.findByRole('dialog')
    await user.type(within(dialog).getByLabelText(/notes/i), 'goodwill')
    const refundInput = within(dialog).getByLabelText(/partial refund/i)
    await user.clear(refundInput)
    await user.type(refundInput, '2000')

    // The A4 figure restates the partial refund being moved (not yet committed).
    expect(within(dialog).getByTestId('confirm-money-amount')).toHaveTextContent('₹2,000')
    expect(resolveCompletedSpy).not.toHaveBeenCalled()

    // Confirm fires the SAME server action with the partial refund.
    await user.click(within(dialog).getByRole('button', { name: /Confirm/i }))
    expect(resolveCompletedSpy).toHaveBeenCalledTimes(1)
    expect(resolveCompletedSpy).toHaveBeenCalledWith(ROW.id, 'goodwill', 2000, undefined)
  })

  it('Resolve as cancelled opens an A4 confirm restating the FULL refund ₹ before commit', async () => {
    const user = userEvent.setup()
    render(<DisputeLedger rows={[ROW]} />)

    const row = document.querySelector(`tr[data-booking-id="${ROW.id}"]`) as HTMLElement
    await user.click(within(row).getByRole('button', { name: /select/i }))
    const detail = screen.getByTestId('ledger-detail-pane')

    await user.click(
      within(detail).getByRole('button', { name: /Resolve as cancelled/i }),
    )
    const dialog = await screen.findByRole('dialog')
    // The full gross is restated as the refund being moved.
    expect(within(dialog).getByTestId('confirm-money-amount')).toHaveTextContent('₹9,000')
    await user.type(within(dialog).getByLabelText(/notes/i), 'not delivered')

    await user.click(within(dialog).getByRole('button', { name: /Confirm/i }))
    expect(resolveCancelledSpy).toHaveBeenCalledTimes(1)
    expect(resolveCancelledSpy).toHaveBeenCalledWith(ROW.id, 'not delivered')
  })

  it('renders an empty state when there are no disputes', () => {
    render(<DisputeLedger rows={[]} />)
    expect(screen.getByText(/No disputed bookings/i)).toBeInTheDocument()
  })
})
