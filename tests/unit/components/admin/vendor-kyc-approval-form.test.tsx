import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { KycApprovalForm } from '@/app/admin/vendors/[id]/kyc-approval-form'

// #101 — the KYC approve / reject controls in the Evidence Cockpit decision rail.
//
// REJECT is destructive (it denies the promotion + records the reason against the
// Vendor), so per the brief it must NOT fire inline: clicking "Reject Promotion"
// opens a plain confirm Dialog that RESTATES the consequence (promotion denied +
// the reason), and rejectKycAction fires ONLY from the explicit confirm inside.
// This fixes the unguarded-destructive-action defect.
//
// APPROVE is a forward promotion (not destructive) and keeps its inline submit so
// the #22 KYC-approve E2E selectors (#approve-notes + "Approve → identity") are
// preserved. Both call the UNCHANGED actions with the same FormData inputs.

type Result = { ok: true } | { ok: false; error: string }

const approveKycAction = vi.fn(async (_fd: FormData): Promise<Result> => ({ ok: true }))
const rejectKycAction = vi.fn(async (_fd: FormData): Promise<Result> => ({ ok: true }))

vi.mock('@/app/admin/vendors/[id]/actions', () => ({
  approveKycAction: (fd: FormData) => approveKycAction(fd),
  rejectKycAction: (fd: FormData) => rejectKycAction(fd),
}))

beforeEach(() => {
  approveKycAction.mockClear()
  rejectKycAction.mockClear()
})
afterEach(() => cleanup())

describe('KycApprovalForm — reject gated behind a confirm Dialog', () => {
  it('approve still fires inline with the same FormData (preserves #22 selectors)', async () => {
    const user = userEvent.setup()
    render(<KycApprovalForm vendorUserId="v1" currentTier="phone" />)

    await user.type(screen.getByLabelText(/Approval Notes/), 'Aadhaar + PAN verified offline.')
    await user.click(screen.getByRole('button', { name: /Approve → identity/ }))

    expect(approveKycAction).toHaveBeenCalledTimes(1)
    const fd = approveKycAction.mock.calls[0][0]
    expect(fd.get('vendorUserId')).toBe('v1')
    expect(fd.get('notes')).toBe('Aadhaar + PAN verified offline.')
  })

  it('clicking "Reject Promotion" does NOT reject inline — it opens a confirm', async () => {
    const user = userEvent.setup()
    render(<KycApprovalForm vendorUserId="v1" currentTier="phone" />)

    await user.type(screen.getByLabelText(/Rejection Reason/), 'PAN does not match name.')
    await user.click(screen.getByRole('button', { name: 'Reject Promotion' }))

    expect(rejectKycAction).not.toHaveBeenCalled()
    expect(screen.getByTestId('reject-kyc-confirm')).toBeInTheDocument()
  })

  it('the confirm restates the consequence: promotion denied + the reason', async () => {
    const user = userEvent.setup()
    render(<KycApprovalForm vendorUserId="v1" currentTier="phone" />)

    await user.type(screen.getByLabelText(/Rejection Reason/), 'PAN does not match name.')
    await user.click(screen.getByRole('button', { name: 'Reject Promotion' }))

    const dialog = screen.getByTestId('reject-kyc-confirm')
    expect(dialog.textContent).toMatch(/promotion/i)
    expect(dialog.textContent).toMatch(/denied|deny|reject/i)
    expect(dialog.textContent).toContain('PAN does not match name.')
  })

  it('rejectKycAction fires only AFTER the explicit confirm, with the reason', async () => {
    const user = userEvent.setup()
    render(<KycApprovalForm vendorUserId="v1" currentTier="phone" />)

    await user.type(screen.getByLabelText(/Rejection Reason/), 'PAN does not match name.')
    await user.click(screen.getByRole('button', { name: 'Reject Promotion' }))
    expect(rejectKycAction).not.toHaveBeenCalled()

    const dialog = screen.getByTestId('reject-kyc-confirm')
    await user.click(within(dialog).getByRole('button', { name: 'Confirm Rejection' }))

    expect(rejectKycAction).toHaveBeenCalledTimes(1)
    const fd = rejectKycAction.mock.calls[0][0]
    expect(fd.get('vendorUserId')).toBe('v1')
    expect(fd.get('reason')).toBe('PAN does not match name.')
  })

  it('cancelling the confirm does NOT reject', async () => {
    const user = userEvent.setup()
    render(<KycApprovalForm vendorUserId="v1" currentTier="phone" />)

    await user.type(screen.getByLabelText(/Rejection Reason/), 'PAN does not match name.')
    await user.click(screen.getByRole('button', { name: 'Reject Promotion' }))
    const dialog = screen.getByTestId('reject-kyc-confirm')
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))

    expect(rejectKycAction).not.toHaveBeenCalled()
  })
})
