import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ExperienceActionsCell } from '@/app/admin/experiences/experience-actions-cell'

// #88 experience-moderation actions cell. Approve PUBLISHES + indexes for
// search and pause/archive DE-INDEX (consequential, ADR-0013), so each
// moderation action is gated behind a confirm Dialog that RESTATES the
// consequence before the action fires (DESIGN.md §4 A4 — consequential
// decisions confirm). Reject already had its reason Dialog.
//
// We mock the Server Actions so the cell can be unit-tested in isolation and
// assert (a) the confirm Dialog restates the search consequence and (b) the
// underlying action only fires AFTER the confirm is clicked.

type Result = { ok: true } | { ok: false; error: string }

const approveExperienceAction = vi.fn(async (_id: string): Promise<Result> => ({ ok: true }))
const pauseExperienceAction = vi.fn(async (_id: string): Promise<Result> => ({ ok: true }))
const archiveExperienceAction = vi.fn(async (_id: string): Promise<Result> => ({ ok: true }))
const rejectExperienceAction = vi.fn(
  async (_id: string, _reason: string): Promise<Result> => ({ ok: true }),
)

vi.mock('@/app/admin/experiences/actions', () => ({
  approveExperienceAction: (id: string) => approveExperienceAction(id),
  pauseExperienceAction: (id: string) => pauseExperienceAction(id),
  archiveExperienceAction: (id: string) => archiveExperienceAction(id),
  rejectExperienceAction: (id: string, reason: string) =>
    rejectExperienceAction(id, reason),
}))

const EXP_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'

beforeEach(() => {
  approveExperienceAction.mockClear()
  pauseExperienceAction.mockClear()
  archiveExperienceAction.mockClear()
  rejectExperienceAction.mockClear()
})

afterEach(() => {
  cleanup()
})

describe('ExperienceActionsCell — consequential moderation behind a confirm Dialog', () => {
  it('approve opens a confirm restating the publish + index consequence; the action fires only after confirm', async () => {
    const user = userEvent.setup()
    render(<ExperienceActionsCell experienceId={EXP_ID} status="pending_review" />)

    // Clicking Approve must NOT fire the action directly — it opens a confirm.
    await user.click(screen.getByRole('button', { name: 'Approve' }))
    expect(approveExperienceAction).not.toHaveBeenCalled()

    // The confirm Dialog restates the consequence (publish + index for search).
    const dialog = screen.getByTestId('approve-confirm')
    expect(dialog).toBeInTheDocument()
    expect(dialog.textContent).toMatch(/index/i)

    // Confirming fires the underlying approve action with the experience id.
    await user.click(within(dialog).getByRole('button', { name: 'Approve & publish' }))
    expect(approveExperienceAction).toHaveBeenCalledWith(EXP_ID)
  })

  it('pause opens a confirm restating the de-index consequence; the action fires only after confirm', async () => {
    const user = userEvent.setup()
    render(<ExperienceActionsCell experienceId={EXP_ID} status="published" />)

    await user.click(screen.getByRole('button', { name: 'Pause' }))
    expect(pauseExperienceAction).not.toHaveBeenCalled()

    const dialog = screen.getByTestId('pause-confirm')
    expect(dialog.textContent).toMatch(/de-?index|removed from search|search/i)

    await user.click(within(dialog).getByRole('button', { name: 'Pause' }))
    expect(pauseExperienceAction).toHaveBeenCalledWith(EXP_ID)
  })

  it('archive opens a confirm restating the catalog removal + de-index consequence; fires only after confirm', async () => {
    const user = userEvent.setup()
    render(<ExperienceActionsCell experienceId={EXP_ID} status="published" />)

    await user.click(screen.getByRole('button', { name: 'Archive' }))
    expect(archiveExperienceAction).not.toHaveBeenCalled()

    const dialog = screen.getByTestId('archive-confirm')
    expect(dialog.textContent).toMatch(/de-?index|catalog|search/i)

    await user.click(within(dialog).getByRole('button', { name: 'Archive' }))
    expect(archiveExperienceAction).toHaveBeenCalledWith(EXP_ID)
  })
})
