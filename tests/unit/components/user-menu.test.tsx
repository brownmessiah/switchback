import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

// Base UI's Menu uses pointer-capture + ResizeObserver + scrollIntoView, none
// of which jsdom implements. Polyfill them so the menu popup actually mounts
// on a real `userEvent.click` of the trigger.
beforeAll(() => {
  if (!globalThis.ResizeObserver) {
    globalThis.ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    } as unknown as typeof ResizeObserver
  }
  if (!Element.prototype.hasPointerCapture) {
    Element.prototype.hasPointerCapture = () => false
    Element.prototype.setPointerCapture = () => {}
    Element.prototype.releasePointerCapture = () => {}
  }
  if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = () => {}
  }
})

// ---- Mocks ----
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}))

vi.mock('@/lib/auth/client', () => ({
  authClient: { signOut: vi.fn(async () => undefined) },
}))

import { UserMenu } from '@/components/user-menu'

afterEach(() => {
  cleanup()
})

const USER = { name: 'Asha Rao', email: 'asha@example.com' }

async function openMenu(): Promise<void> {
  const user = userEvent.setup()
  render(<UserMenu user={USER} />)
  // Base UI's Menu mounts its items on keyboard activation of the focused
  // trigger; a bare pointer click does not open it under jsdom. Focus via
  // click, then press Enter to open the popup.
  const trigger = screen.getByRole('button')
  await user.click(trigger)
  await user.keyboard('{Enter}')
}

describe('UserMenu — Trip Groups entry (issue 03)', () => {
  it('surfaces a "Trip Groups" entry that links to /community', async () => {
    await openMenu()

    const link = screen.getByRole('link', { name: 'Trip Groups' })
    expect(link).toBeInTheDocument()
    expect(link).toHaveAttribute('href', '/community')
  })

  it('no longer shows the old vague "Community" label', async () => {
    await openMenu()

    expect(screen.queryByText('Community')).not.toBeInTheDocument()
    expect(
      screen.queryByRole('link', { name: 'Community' }),
    ).not.toBeInTheDocument()
  })

  it('keeps the existing account links (My bookings, Support, Account settings)', async () => {
    await openMenu()

    expect(screen.getByRole('link', { name: 'My bookings' })).toHaveAttribute(
      'href',
      '/dashboard',
    )
    expect(screen.getByRole('link', { name: 'Support' })).toHaveAttribute(
      'href',
      '/support',
    )
    expect(
      screen.getByRole('link', { name: 'Account settings' }),
    ).toHaveAttribute('href', '/settings')
  })
})
