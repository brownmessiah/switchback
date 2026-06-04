import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

const mockPush = vi.fn()
const nav = { params: new URLSearchParams('') }

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
  usePathname: () => '/search',
  useSearchParams: () => nav.params,
}))

import { ViewToggle } from '@/components/search/view-toggle'

afterEach(() => {
  cleanup()
  mockPush.mockClear()
  nav.params = new URLSearchParams('')
})

describe('ViewToggle', () => {
  it('marks the current view as pressed', () => {
    render(<ViewToggle current="list" gridLabel="Grid" listLabel="List" />)
    expect(screen.getByRole('button', { name: 'List' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'Grid' })).toHaveAttribute('aria-pressed', 'false')
  })

  it('navigates to ?view=list, preserving existing params', () => {
    nav.params = new URLSearchParams('q=goa')
    render(<ViewToggle current="grid" gridLabel="Grid" listLabel="List" />)
    fireEvent.click(screen.getByRole('button', { name: 'List' }))
    expect(mockPush).toHaveBeenCalledWith('/search?q=goa&view=list', { scroll: false })
  })

  it('removes the view param when switching back to grid (the default)', () => {
    nav.params = new URLSearchParams('view=list')
    render(<ViewToggle current="list" gridLabel="Grid" listLabel="List" />)
    fireEvent.click(screen.getByRole('button', { name: 'Grid' }))
    expect(mockPush).toHaveBeenCalledWith('/search', { scroll: false })
  })
})
