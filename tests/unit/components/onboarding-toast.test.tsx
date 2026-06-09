import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Issue 24 — the Vendor onboarding form fires a success toast when the Vendor
 * application (profile) is saved, and an error toast when the create fails. The
 * existing inline error + redirect to /vendor/dashboard are preserved.
 */

const { toast, push, createVendorProfileAction } = vi.hoisted(() => ({
  toast: Object.assign(vi.fn(), {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
  }),
  push: vi.fn(),
  createVendorProfileAction: vi.fn<(input: unknown) => Promise<unknown>>(),
}))
vi.mock('@/lib/toast', () => ({ toast }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }))
vi.mock('@/app/vendor/onboarding/actions', () => ({
  createVendorProfileAction: (input: unknown) => createVendorProfileAction(input),
}))

import { OnboardingForm } from '@/app/vendor/onboarding/onboarding-form'

beforeEach(() => {
  push.mockClear()
  toast.success.mockClear()
  toast.error.mockClear()
  createVendorProfileAction.mockReset()
  window.localStorage.clear()
})

afterEach(() => {
  cleanup()
})

async function fillAndSubmit(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText(/business name/i), 'Himalayan Adventures')
  await user.click(screen.getByRole('button', { name: /continue/i })) // step 1 -> 2
  await user.click(screen.getByRole('button', { name: /continue/i })) // step 2 -> 3
  await user.click(screen.getByRole('button', { name: /create vendor profile/i }))
}

describe('OnboardingForm — Vendor application saved toast (issue 24)', () => {
  it('fires a success toast when the Vendor profile is created', async () => {
    createVendorProfileAction.mockResolvedValue({ ok: true })
    const user = userEvent.setup()
    render(<OnboardingForm userId="u-1" />)

    await fillAndSubmit(user)

    expect(toast.success).toHaveBeenCalled()
    expect(push).toHaveBeenCalledWith('/vendor/dashboard')
  })

  it('fires an error toast when the create fails', async () => {
    createVendorProfileAction.mockResolvedValue({ ok: false, error: 'Slug already taken.' })
    const user = userEvent.setup()
    render(<OnboardingForm userId="u-1" />)

    await fillAndSubmit(user)

    expect(toast.error).toHaveBeenCalledWith('Slug already taken.')
    expect(push).not.toHaveBeenCalled()
  })
})
