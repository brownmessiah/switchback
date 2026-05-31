import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { SuspendToggleForm } from '@/app/admin/vendors/[id]/suspend-toggle-form'

// #101 — Suspend / Reactivate in the Evidence Cockpit decision rail.
//
// Suspending is destructive (a suspended Vendor can NOT take Bookings), so per
// the brief it must NOT fire inline: clicking "Suspend Vendor" opens a plain
// confirm Dialog restating the consequence, and toggleSuspendAction fires ONLY
// from the explicit confirm inside. A misclick must never suspend a Vendor
// (the load-bearing "before" defect). The action is called UNCHANGED with the
// same FormData inputs; #suspend-notes + the trigger names are preserved for #22.

type Result = { ok: true } | { ok: false; error: string }

const toggleSuspendAction = vi.fn(async (_fd: FormData): Promise<Result> => ({ ok: true }))

vi.mock('@/app/admin/vendors/[id]/actions', () => ({
  toggleSuspendAction: (fd: FormData) => toggleSuspendAction(fd),
}))

beforeEach(() => toggleSuspendAction.mockClear())
afterEach(() => cleanup())

describe('SuspendToggleForm — suspend gated behind a confirm Dialog', () => {
  it('clicking "Suspend Vendor" does NOT suspend inline — it opens a confirm', async () => {
    const user = userEvent.setup()
    render(<SuspendToggleForm vendorUserId="v1" suspended={false} />)

    await user.type(screen.getByLabelText(/Suspension Notes/), 'Repeated policy violations.')
    await user.click(screen.getByRole('button', { name: 'Suspend Vendor' }))

    expect(toggleSuspendAction).not.toHaveBeenCalled()
    expect(screen.getByTestId('suspend-vendor-confirm')).toBeInTheDocument()
  })

  it('the confirm restates the consequence: the Vendor cannot take Bookings', async () => {
    const user = userEvent.setup()
    render(<SuspendToggleForm vendorUserId="v1" suspended={false} />)

    await user.type(screen.getByLabelText(/Suspension Notes/), 'Repeated policy violations.')
    await user.click(screen.getByRole('button', { name: 'Suspend Vendor' }))

    const dialog = screen.getByTestId('suspend-vendor-confirm')
    expect(dialog.textContent).toMatch(/can(not|'t)\s+take\s+(new\s+)?[Bb]ookings/i)
  })

  it('toggleSuspendAction fires only AFTER the explicit confirm, with the notes', async () => {
    const user = userEvent.setup()
    render(<SuspendToggleForm vendorUserId="v1" suspended={false} />)

    await user.type(screen.getByLabelText(/Suspension Notes/), 'Repeated policy violations.')
    await user.click(screen.getByRole('button', { name: 'Suspend Vendor' }))
    expect(toggleSuspendAction).not.toHaveBeenCalled()

    const dialog = screen.getByTestId('suspend-vendor-confirm')
    await user.click(within(dialog).getByRole('button', { name: 'Confirm Suspend' }))

    expect(toggleSuspendAction).toHaveBeenCalledTimes(1)
    const fd = toggleSuspendAction.mock.calls[0][0]
    expect(fd.get('vendorUserId')).toBe('v1')
    expect(fd.get('notes')).toBe('Repeated policy violations.')
  })

  it('cancelling the confirm does NOT suspend', async () => {
    const user = userEvent.setup()
    render(<SuspendToggleForm vendorUserId="v1" suspended={false} />)

    await user.type(screen.getByLabelText(/Suspension Notes/), 'Repeated policy violations.')
    await user.click(screen.getByRole('button', { name: 'Suspend Vendor' }))
    const dialog = screen.getByTestId('suspend-vendor-confirm')
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))

    expect(toggleSuspendAction).not.toHaveBeenCalled()
  })

  it('reactivation is non-destructive and fires inline with the same FormData', async () => {
    const user = userEvent.setup()
    render(<SuspendToggleForm vendorUserId="v1" suspended={true} />)

    await user.type(screen.getByLabelText(/Reactivation Notes/), 'Issue resolved, reinstated.')
    await user.click(screen.getByRole('button', { name: 'Reactivate Vendor' }))

    expect(toggleSuspendAction).toHaveBeenCalledTimes(1)
    const fd = toggleSuspendAction.mock.calls[0][0]
    expect(fd.get('vendorUserId')).toBe('v1')
    expect(fd.get('notes')).toBe('Issue resolved, reinstated.')
  })
})
