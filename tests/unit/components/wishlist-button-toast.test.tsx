import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Issue 24 — the WishlistButton must fire a toast when an Experience is added
 * to / removed from the Wishlist, and a "sign in" toast on the login-gated
 * (unauthenticated) path. The optimistic flip + existing sign-in redirect are
 * preserved (toasts ADD to working UX, never replace it).
 */

// next-intl: t() echoes the key so we assert against stable keys, not copy.
vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
}))

const push = vi.fn()
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push }),
}))

const { toast } = vi.hoisted(() => ({
  toast: Object.assign(vi.fn(), {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
  }),
}))
vi.mock('@/lib/toast', () => ({ toast }))

const toggleWishlistAction = vi.fn<(id: string) => Promise<unknown>>()
vi.mock('@/app/(app)/wishlist/actions', () => ({
  toggleWishlistAction: (id: string) => toggleWishlistAction(id),
}))

import { WishlistButton } from '@/components/wishlist-button'

const EXPERIENCE_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'

beforeEach(() => {
  push.mockClear()
  toast.mockClear()
  toast.success.mockClear()
  toast.error.mockClear()
  toast.info.mockClear()
  toggleWishlistAction.mockReset()
})

afterEach(() => {
  cleanup()
})

describe('WishlistButton — action toasts (issue 24)', () => {
  it('fires a success toast when an Experience is added to the Wishlist', async () => {
    toggleWishlistAction.mockResolvedValue({ ok: true, saved: true })
    const user = userEvent.setup()
    render(<WishlistButton experienceId={EXPERIENCE_ID} initialSaved={false} />)

    await user.click(screen.getByTestId('wishlist-button'))

    expect(toast.success).toHaveBeenCalledWith('toast.added')
    expect(push).not.toHaveBeenCalled()
  })

  it('fires a toast when an Experience is removed from the Wishlist', async () => {
    toggleWishlistAction.mockResolvedValue({ ok: true, saved: false })
    const user = userEvent.setup()
    render(<WishlistButton experienceId={EXPERIENCE_ID} initialSaved={true} />)

    await user.click(screen.getByTestId('wishlist-button'))

    expect(toast.success).toHaveBeenCalledWith('toast.removed')
  })

  it('fires a "sign in" toast first, then defers the /sign-in redirect so the toast is seen', async () => {
    // Spy on setTimeout to capture the deferred redirect without waiting in real
    // time (the deferral exists so the toast paints before navigation tears down
    // the Toaster — issue 24).
    const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout')
    try {
      toggleWishlistAction.mockResolvedValue({ ok: false, error: 'unauthenticated' })
      const user = userEvent.setup()
      render(<WishlistButton experienceId={EXPERIENCE_ID} initialSaved={false} />)

      await user.click(screen.getByTestId('wishlist-button'))

      // The toast explains why the heart didn't stick — fired immediately.
      expect(toast.info).toHaveBeenCalledWith('toast.signInRequired')
      // The redirect is DEFERRED: pushing on the same tick would discard the
      // toast, so it is scheduled via setTimeout, not called synchronously.
      expect(push).not.toHaveBeenCalled()
      const deferred = setTimeoutSpy.mock.calls.find(
        ([, delay]) => typeof delay === 'number' && delay >= 1000,
      )
      expect(deferred, 'redirect should be deferred ~1.2s for toast visibility').toBeDefined()

      // Invoking the scheduled callback performs the redirect (existing UX preserved).
      ;(deferred![0] as () => void)()
      expect(push).toHaveBeenCalledWith('/sign-in')
    } finally {
      setTimeoutSpy.mockRestore()
    }
  })
})
