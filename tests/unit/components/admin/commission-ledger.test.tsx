import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { CommissionLedger, type CommissionTierRow } from '@/app/admin/commission/commission-ledger'

const updateSpy = vi.fn((..._args: unknown[]) => Promise.resolve({ ok: true as const }))
const deleteSpy = vi.fn((..._args: unknown[]) => Promise.resolve({ ok: true as const }))

vi.mock('@/app/admin/commission/actions', () => ({
  updateCommissionTier: (formData: FormData) => updateSpy(formData),
  deleteCommissionTier: (id: string) => deleteSpy(id),
}))

afterEach(() => {
  cleanup()
  updateSpy.mockClear()
  deleteSpy.mockClear()
})

const TIER: CommissionTierRow = {
  id: '33333333-3333-3333-3333-333333333333',
  name: 'diwali-2026',
  status: 'active',
  label: 'Active',
  rateOverride: '12.50',
  reason: 'Festival season',
  startAt: new Date('2026-10-01T00:00:00Z').toISOString(),
  endAt: new Date('2026-11-01T00:00:00Z').toISOString(),
  startAtLabel: '1 Oct 2026',
  endAtLabel: '1 Nov 2026',
  scopeLabel: 'All',
  affectedBookings: 42,
  adminLabel: 'admin@switchback.in',
}

describe('CommissionLedger split-view (rate + scope co-present with action)', () => {
  it('shows the selected tier rate + blast-radius CO-PRESENT with its edit action', async () => {
    const user = userEvent.setup()
    render(<CommissionLedger tiers={[TIER]} />)

    const row = screen.getByTestId(`tier-row-${TIER.id}`)
    await user.click(within(row).getByRole('button', { name: /select/i }))

    const detail = screen.getByTestId('ledger-detail-pane')
    expect(within(detail).getByTestId('tier-rate')).toHaveTextContent('12.5')
    // blast radius (affected existing Bookings) is co-present
    expect(within(detail).getByTestId('tier-affected')).toHaveTextContent('42')
    expect(within(detail).getByRole('button', { name: 'Edit' })).toBeInTheDocument()
  })

  it('exposes the status tabs Active / Upcoming / Expired', () => {
    render(<CommissionLedger tiers={[TIER]} />)
    expect(screen.getByRole('tab', { name: /Active/ })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: /Upcoming/ })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: /Expired/ })).toBeInTheDocument()
  })

  it('edit confirm restates the exact new rate before committing the update', async () => {
    const user = userEvent.setup()
    render(<CommissionLedger tiers={[TIER]} />)

    // Scope to the detail-pane Edit (the split-view co-present action); the
    // queue row also exposes an Edit, so the page-wide query is ambiguous.
    const detail = screen.getByTestId('ledger-detail-pane')
    await user.click(within(detail).getByRole('button', { name: 'Edit' }))
    const dialog = await screen.findByRole('dialog')

    // Change the rate to a new exact figure.
    const rateInput = within(dialog).getByLabelText(/Rate/i)
    await user.clear(rateInput)
    await user.type(rateInput, '15')

    // The confirm restates the exact new rate; the update only fires on confirm.
    expect(updateSpy).not.toHaveBeenCalled()
    await user.click(within(dialog).getByRole('button', { name: /Save/i }))

    const confirm = screen.getByTestId('tier-rate-confirm')
    expect(confirm).toHaveTextContent('15')

    await user.click(screen.getByRole('button', { name: 'Confirm rate change' }))
    expect(updateSpy).toHaveBeenCalledTimes(1)

    // Lock the submitted payload: the FormData must carry the edited rate AND
    // the tier id (so the edit path targets the right tier with the new rate).
    const formData = updateSpy.mock.calls[0]![0] as FormData
    expect(formData).toBeInstanceOf(FormData)
    expect(formData.get('rateOverride')).toBe('15')
    expect(formData.get('id')).toBe(TIER.id)
  })
})
