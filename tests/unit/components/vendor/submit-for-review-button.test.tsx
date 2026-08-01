import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { SubmitForReviewButton } from '@/app/vendor/(dashboard)/listings/submit-for-review-button'

/**
 * The Vendor-facing half of the `draft → pending_review` transition.
 *
 * Until this existed a Vendor could create a listing and had no way to ask for
 * it to be reviewed — the listing sat at `draft` forever and the admin queue
 * (which only reads `pending_review`) never saw it.
 *
 * The control must be honest about WHY it is unavailable: a listing that is
 * not yet complete gets a disabled button with the percentage, not a silently
 * missing one.
 */

type Result = { ok: true; status: 'pending_review' } | { ok: false; error: string }

const submitExperienceForReviewAction = vi.fn(
  async (_id: string): Promise<Result> => ({ ok: true, status: 'pending_review' }),
)

vi.mock('@/app/vendor/(dashboard)/listings/[id]/submit-actions', () => ({
  submitExperienceForReviewAction: (id: string) => submitExperienceForReviewAction(id),
}))

beforeEach(() => {
  submitExperienceForReviewAction.mockReset()
  submitExperienceForReviewAction.mockResolvedValue({ ok: true, status: 'pending_review' })
})
afterEach(() => cleanup())

describe('SubmitForReviewButton', () => {
  it('submits a complete draft for review', async () => {
    const user = userEvent.setup()
    render(
      <SubmitForReviewButton experienceId="exp-1" status="draft" completenessPercent={100} />,
    )

    await user.click(screen.getByRole('button', { name: /Submit for review/i }))

    expect(submitExperienceForReviewAction).toHaveBeenCalledWith('exp-1')
  })

  it('disables the control on an incomplete draft and shows how far along it is', () => {
    render(
      <SubmitForReviewButton experienceId="exp-1" status="draft" completenessPercent={60} />,
    )

    expect(screen.getByRole('button', { name: /Submit for review/i })).toBeDisabled()
    expect(screen.getByText(/60%/)).toBeInTheDocument()
  })

  it('reports that the listing is already queued once submitted', () => {
    render(
      <SubmitForReviewButton
        experienceId="exp-1"
        status="pending_review"
        completenessPercent={100}
      />,
    )

    expect(screen.getByText(/in review/i)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Submit for review/i })).not.toBeInTheDocument()
  })

  it('shows nothing to submit for a listing that is already live', () => {
    render(
      <SubmitForReviewButton
        experienceId="exp-1"
        status="published"
        completenessPercent={100}
      />,
    )

    expect(screen.queryByRole('button', { name: /Submit for review/i })).not.toBeInTheDocument()
  })

  it('surfaces a server-side refusal instead of failing silently', async () => {
    const user = userEvent.setup()
    submitExperienceForReviewAction.mockResolvedValue({
      ok: false,
      error: 'You do not own this experience.',
    })
    render(
      <SubmitForReviewButton experienceId="exp-1" status="draft" completenessPercent={100} />,
    )

    await user.click(screen.getByRole('button', { name: /Submit for review/i }))

    expect(await screen.findByRole('alert')).toHaveTextContent(/do not own/i)
  })

  it('confirms success in place so the Vendor knows the queue accepted it', async () => {
    const user = userEvent.setup()
    render(
      <SubmitForReviewButton experienceId="exp-1" status="draft" completenessPercent={100} />,
    )

    await user.click(screen.getByRole('button', { name: /Submit for review/i }))

    expect(await screen.findByRole('status')).toHaveTextContent(/review/i)
  })
})
