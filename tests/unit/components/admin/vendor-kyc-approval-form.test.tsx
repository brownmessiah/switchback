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
type ApproveResult =
  | { ok: true; publishedCount: number; skipped: { experienceId: string; code: string; reason: string }[] }
  | { ok: false; error: string }

const approveKycAction = vi.fn(
  async (_fd: FormData): Promise<ApproveResult> => ({ ok: true, publishedCount: 0, skipped: [] }),
)
const rejectKycAction = vi.fn(async (_fd: FormData): Promise<Result> => ({ ok: true }))

vi.mock('@/app/admin/vendors/[id]/actions', () => ({
  approveKycAction: (fd: FormData) => approveKycAction(fd),
  rejectKycAction: (fd: FormData) => rejectKycAction(fd),
}))

beforeEach(() => {
  approveKycAction.mockReset()
  approveKycAction.mockResolvedValue({ ok: true, publishedCount: 0, skipped: [] })
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

// ── BUG A — the decision rail must render at EVERY tier ──────────────
//
// Reported by the product owner as "the accept/reject controls sometimes
// appear and sometimes don't". It is not a race: the whole approve+reject
// block was wrapped in `{canPromote ? … }` and KYC_TIER_NEXT has no
// 'business' key, so at the top tier the controls were ABSENT from the DOM
// rather than present-and-explained. Most Vendors sit at 'business', so an
// admin clicking between Vendors saw the rail come and go.
//
// The rule this locks in: a decision control is never absent. It may be
// disabled with a stated reason, but the admin must always see it.

describe('KycApprovalForm — the decision rail renders at every tier', () => {
  it('renders both approve and reject at the highest KYC tier', () => {
    render(<KycApprovalForm vendorUserId="v1" currentTier="business" />)

    expect(screen.getByRole('button', { name: /Approve/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Reject Promotion' })).toBeInTheDocument()
  })

  it('disables approve at the highest tier and states why', () => {
    render(<KycApprovalForm vendorUserId="v1" currentTier="business" />)

    expect(screen.getByRole('button', { name: /Approve/ })).toBeDisabled()
    expect(screen.getByText(/highest KYC tier/i)).toBeInTheDocument()
  })

  it('keeps reject actionable at the highest tier', async () => {
    const user = userEvent.setup()
    render(<KycApprovalForm vendorUserId="v1" currentTier="business" />)

    const reject = screen.getByRole('button', { name: 'Reject Promotion' })
    expect(reject).toBeEnabled()

    await user.type(screen.getByLabelText(/Rejection Reason/), 'Fraudulent GSTIN on re-audit.')
    await user.click(reject)

    const dialog = screen.getByTestId('reject-kyc-confirm')
    await user.click(within(dialog).getByRole('button', { name: 'Confirm Rejection' }))

    expect(rejectKycAction).toHaveBeenCalledTimes(1)
    expect(rejectKycAction.mock.calls[0][0].get('reason')).toBe('Fraudulent GSTIN on re-audit.')
  })

  it('renders the approval-notes field at the highest tier so the rail keeps its shape', () => {
    render(<KycApprovalForm vendorUserId="v1" currentTier="business" />)

    expect(screen.getByLabelText(/Approval Notes/)).toBeInTheDocument()
  })
})

// Approving a Vendor now also puts their queued listings live (BUG B). The
// admin must SEE that consequence — both what went live and what was held
// back by the ADR-0007 tier caps — or the cascade is invisible and they will
// go on believing nothing happened, which is the original complaint.

describe('KycApprovalForm — reports what the approval put live', () => {
  it('states how many listings went live on approval', async () => {
    const user = userEvent.setup()
    approveKycAction.mockResolvedValue({ ok: true, publishedCount: 2, skipped: [] })
    render(<KycApprovalForm vendorUserId="v1" currentTier="phone" />)

    await user.type(screen.getByLabelText(/Approval Notes/), 'Verified.')
    await user.click(screen.getByRole('button', { name: /Approve → identity/ }))

    expect(await screen.findByRole('status')).toHaveTextContent(/2 listing/i)
  })

  it('names the listings held back by the tier caps, with the reason', async () => {
    const user = userEvent.setup()
    approveKycAction.mockResolvedValue({
      ok: true,
      publishedCount: 0,
      skipped: [
        {
          experienceId: 'exp-1',
          code: 'PRICE_OVER_CAP',
          reason: 'Identity-verified Vendors may charge up to Rs.5000 per person.',
        },
      ],
    })
    render(<KycApprovalForm vendorUserId="v1" currentTier="phone" />)

    await user.type(screen.getByLabelText(/Approval Notes/), 'Verified.')
    await user.click(screen.getByRole('button', { name: /Approve → identity/ }))

    const held = await screen.findByTestId('cascade-skipped')
    expect(held.textContent).toMatch(/Rs.5000 per person/)
  })

  it('says so plainly when the Vendor had nothing queued', async () => {
    const user = userEvent.setup()
    render(<KycApprovalForm vendorUserId="v1" currentTier="phone" />)

    await user.type(screen.getByLabelText(/Approval Notes/), 'Verified.')
    await user.click(screen.getByRole('button', { name: /Approve → identity/ }))

    expect(await screen.findByRole('status')).toHaveTextContent(/no listings were waiting/i)
  })
})

// A control that is disabled before the admin has typed anything reads as
// dead — it is part of the same "the buttons don't work" report. Reject is
// always clickable; the empty-reason guard moves to the click handler so
// the admin gets told what is missing instead of being stonewalled.

describe('KycApprovalForm — reject is never a dead control', () => {
  it('leaves reject enabled before a reason is typed', () => {
    render(<KycApprovalForm vendorUserId="v1" currentTier="phone" />)

    expect(screen.getByRole('button', { name: 'Reject Promotion' })).toBeEnabled()
  })

  it('asks for a reason instead of opening the confirm when the box is empty', async () => {
    const user = userEvent.setup()
    render(<KycApprovalForm vendorUserId="v1" currentTier="phone" />)

    await user.click(screen.getByRole('button', { name: 'Reject Promotion' }))

    expect(screen.queryByTestId('reject-kyc-confirm')).not.toBeInTheDocument()
    expect(rejectKycAction).not.toHaveBeenCalled()
    expect(screen.getByRole('alert').textContent).toMatch(/reason/i)
  })
})
