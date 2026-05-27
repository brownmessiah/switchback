import { renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { ReactNode } from 'react'

import { useIntl, IntlProvider } from './provider'

// Mock next/navigation
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
  usePathname: () => '/',
}))

// Mock next-intl client provider
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
})
