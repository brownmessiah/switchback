import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

const mockPush = vi.fn()
const nav = { params: new URLSearchParams('') }

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
  usePathname: () => '/search',
  useSearchParams: () => nav.params,
}))

import { SearchBox } from '@/components/search/search-box'

afterEach(() => {
  cleanup()
  mockPush.mockClear()
  nav.params = new URLSearchParams('')
})

describe('SearchBox', () => {
  it('renders the initial query value', () => {
    render(
      <SearchBox initialQuery="rafting" placeholder="Search…" label="Search" submitLabel="Go" />,
    )
    expect(screen.getByRole('searchbox')).toHaveValue('rafting')
  })

  it('navigates with the q param on submit, preserving existing params', () => {
    nav.params = new URLSearchParams('category=water-sports')
    render(<SearchBox initialQuery="" placeholder="p" label="Search" submitLabel="Go" />)
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'goa scuba' } })
    fireEvent.submit(screen.getByTestId('search-box'))
    expect(mockPush).toHaveBeenCalledWith(
      '/search?category=water-sports&q=goa+scuba',
      { scroll: false },
    )
  })

  it('removes the q param when submitted empty/whitespace', () => {
    nav.params = new URLSearchParams('q=old')
    render(<SearchBox initialQuery="old" placeholder="p" label="Search" submitLabel="Go" />)
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: '   ' } })
    fireEvent.submit(screen.getByTestId('search-box'))
    expect(mockPush).toHaveBeenCalledWith('/search', { scroll: false })
  })
})
