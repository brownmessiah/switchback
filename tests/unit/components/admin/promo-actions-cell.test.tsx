import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { PromoActionsCell } from '@/app/admin/promo/promo-actions-cell'

// #95 promo actions cell. Deactivating stops a LIVE promo (no more redemptions)
// and deleting permanently removes it (ADR-0004) — both consequential, so each
// is gated behind a confirm Dialog that restates the consequence before the
// action fires (DESIGN.md §4 A4 — consequential decisions confirm). A misclick
// must NOT toggle or delete a promo.
//
// We mock the Server Actions so the cell can be unit-tested in isolation and
// assert (a) the confirm Dialog restates the consequence and (b) the underlying
// action only fires AFTER the confirm is clicked, with the same inputs the
// unchanged actions expect.

type Result = { ok: true } | { ok: false; error: string }

const togglePromoCode = vi.fn(async (_id: string, _active: boolean): Promise<Result> => ({ ok: true }))
const deletePromoCode = vi.fn(async (_id: string): Promise<Result> => ({ ok: true }))

vi.mock('@/app/admin/promo/actions', () => ({
  togglePromoCode: (id: string, active: boolean) => togglePromoCode(id, active),
  deletePromoCode: (id: string) => deletePromoCode(id),
}))

const PROMO_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'

beforeEach(() => {
  togglePromoCode.mockClear()
  deletePromoCode.mockClear()
})

afterEach(() => {
  cleanup()
})

describe('PromoActionsCell — consequential toggle/delete behind a confirm Dialog', () => {
  it('deactivate opens a confirm restating the "stops a live promo" consequence; toggles only after confirm', async () => {
    const user = userEvent.setup()
    render(<PromoActionsCell id={PROMO_ID} active currentUses={0} />)

    await user.click(screen.getByRole('button', { name: 'Deactivate' }))
    expect(togglePromoCode).not.toHaveBeenCalled()

    const dialog = screen.getByTestId('promo-deactivate-confirm')
    expect(dialog.textContent).toMatch(/stop|live|no longer|redeem/i)

    await user.click(within(dialog).getByRole('button', { name: 'Deactivate' }))
    expect(togglePromoCode).toHaveBeenCalledWith(PROMO_ID, false)
  })

  it('an inactive promo offers Activate (no confirm — re-enabling is not destructive)', async () => {
    const user = userEvent.setup()
    render(<PromoActionsCell id={PROMO_ID} active={false} currentUses={0} />)

    await user.click(screen.getByRole('button', { name: 'Activate' }))
    expect(togglePromoCode).toHaveBeenCalledWith(PROMO_ID, true)
  })

  it('delete opens a confirm restating the permanent removal; deletes only after confirm', async () => {
    const user = userEvent.setup()
    render(<PromoActionsCell id={PROMO_ID} active currentUses={0} />)

    await user.click(screen.getByRole('button', { name: 'Delete' }))
    expect(deletePromoCode).not.toHaveBeenCalled()

    const dialog = screen.getByTestId('promo-delete-confirm')
    expect(dialog.textContent).toMatch(/remove|permanent|cannot be undone|delete/i)

    await user.click(within(dialog).getByRole('button', { name: 'Delete' }))
    expect(deletePromoCode).toHaveBeenCalledWith(PROMO_ID)
  })

  it('hides Delete for a redeemed promo (currentUses > 0)', () => {
    render(<PromoActionsCell id={PROMO_ID} active currentUses={3} />)
    expect(screen.queryByRole('button', { name: 'Delete' })).not.toBeInTheDocument()
  })
})
