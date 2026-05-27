import { renderHook, act } from '@testing-library/react'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import type { ReactNode } from 'react'

import { useIntl, IntlProvider } from './provider'

const mockPush = vi.fn()

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
  usePathname: () => '/',
}))

vi.mock('next-intl', () => ({
  NextIntlClientProvider: ({ children }: { children: ReactNode }) => children,
  useLocale: () => 'en',
}))

function wrapper({ children }: { children: ReactNode }) {
  return (
    <IntlProvider locale="en" messages={{}}>
      {children}
    </IntlProvider>
  )
}

describe('useIntl()', () => {
  beforeEach(() => {
    mockPush.mockClear()
    document.documentElement.lang = 'en'
    document.documentElement.removeAttribute('data-locale')
  })

  it('returns the current locale', () => {
    const { result } = renderHook(() => useIntl(), { wrapper })
    expect(result.current.locale).toBe('en')
  })

  it('exposes switchLocale function', () => {
    const { result } = renderHook(() => useIntl(), { wrapper })
    expect(typeof result.current.switchLocale).toBe('function')
  })

  it('throws when used outside IntlProvider', () => {
    expect(() => {
      renderHook(() => useIntl())
    }).toThrow('useIntl must be used within an IntlProvider')
  })

  it('updates document.documentElement.lang immediately on switchLocale', () => {
    const { result } = renderHook(() => useIntl(), { wrapper })
    act(() => {
      result.current.switchLocale('hi')
    })
    expect(document.documentElement.lang).toBe('hi')
    expect(document.documentElement.getAttribute('data-locale')).toBe('hi')
  })
})
