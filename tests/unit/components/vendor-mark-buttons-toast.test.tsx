import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Issue 24 — the vendor Mark Complete / Mark No-Show buttons previously called
 * the browser `alert()` on failure ("In production this would be a toast"). They
 * must now fire `toast.error(result.error)` instead — no raw alert() left. On
 * success they still `router.refresh()`.
 */

const refresh = vi.fn()
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh }),
}))

const { toast, markCompleteAction, markNoShowAction } = vi.hoisted(() => ({
  toast: Object.assign(vi.fn(), {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
  }),
  markCompleteAction: vi.fn<(id: string) => Promise<unknown>>(),
  markNoShowAction: vi.fn<(id: string) => Promise<unknown>>(),
}))
vi.mock('@/lib/toast', () => ({ toast }))
vi.mock('@/app/vendor/(dashboard)/bookings/actions', () => ({
  markCompleteAction: (id: string) => markCompleteAction(id),
  markNoShowAction: (id: string) => markNoShowAction(id),
}))

import { MarkCompleteButton } from '@/app/vendor/(dashboard)/bookings/mark-complete-button'
import { MarkNoShowButton } from '@/app/vendor/(dashboard)/bookings/mark-no-show-button'

const BOOKING_ID = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'

beforeEach(() => {
  refresh.mockClear()
  toast.error.mockClear()
  toast.success.mockClear()
  markCompleteAction.mockReset()
  markNoShowAction.mockReset()
  vi.spyOn(window, 'alert').mockImplementation(() => undefined)
  vi.spyOn(window, 'confirm').mockReturnValue(true)
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('MarkCompleteButton — failure toast (issue 24)', () => {
  it('fires toast.error (not alert) when the action fails', async () => {
    markCompleteAction.mockResolvedValue({ ok: false, error: 'Slot has not ended yet.' })
    const user = userEvent.setup()
    render(<MarkCompleteButton bookingId={BOOKING_ID} />)

    await user.click(screen.getByRole('button', { name: /mark complete/i }))

    expect(toast.error).toHaveBeenCalledWith('Slot has not ended yet.')
    expect(window.alert).not.toHaveBeenCalled()
    expect(refresh).not.toHaveBeenCalled()
  })

  it('refreshes on success', async () => {
    markCompleteAction.mockResolvedValue({ ok: true, bookingId: BOOKING_ID })
    const user = userEvent.setup()
    render(<MarkCompleteButton bookingId={BOOKING_ID} />)

    await user.click(screen.getByRole('button', { name: /mark complete/i }))

    expect(refresh).toHaveBeenCalled()
    expect(toast.error).not.toHaveBeenCalled()
  })
})

describe('MarkNoShowButton — failure toast (issue 24)', () => {
  it('fires toast.error (not alert) when the action fails', async () => {
    markNoShowAction.mockResolvedValue({ ok: false, error: 'Cannot mark no-show.' })
    const user = userEvent.setup()
    render(<MarkNoShowButton bookingId={BOOKING_ID} />)

    await user.click(screen.getByRole('button', { name: /mark no-show/i }))

    expect(toast.error).toHaveBeenCalledWith('Cannot mark no-show.')
    expect(window.alert).not.toHaveBeenCalled()
  })
})
