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

  it('fires a "sign in" toast and routes to /sign-in on the unauthenticated path', async () => {
    toggleWishlistAction.mockResolvedValue({ ok: false, error: 'unauthenticated' })
    const user = userEvent.setup()
    render(<WishlistButton experienceId={EXPERIENCE_ID} initialSaved={false} />)

    await user.click(screen.getByTestId('wishlist-button'))

    // Existing UX preserved: still routes to sign-in.
    expect(push).toHaveBeenCalledWith('/sign-in')
    // New: a toast explains why.
    expect(toast.info).toHaveBeenCalledWith('toast.signInRequired')
  })
})
