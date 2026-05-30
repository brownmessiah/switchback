/**
 * Tests for VendorSidebar i18n integration.
 *
 * Verifies that the vendor sidebar renders translated labels via
 * useTranslations('VendorNav') when wrapped with NextIntlClientProvider.
 */

import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import enMessages from '@/lib/i18n/messages/en.json'
import hiMessages from '@/lib/i18n/messages/hi.json'

import { VendorSidebar } from './vendor-sidebar'

// Mock next/navigation
vi.mock('next/navigation', () => ({
  usePathname: () => '/vendor/dashboard',
}))

/**
 * Wrapper that provides NextIntlClientProvider with the given locale/messages.
 */
function renderWithIntl(
  ui: React.ReactElement,
  { locale, messages }: { locale: string; messages: Record<string, unknown> },
) {
  const { NextIntlClientProvider } = require('next-intl')
  return render(
    <NextIntlClientProvider locale={locale} messages={messages}>
      {ui}
    </NextIntlClientProvider>,
  )
}

// Unmount every rendered tree after each test. VendorSidebar is a 'use client'
// component whose effects schedule React work via the scheduler's setImmediate.
// Without an explicit unmount, that deferred task can fire AFTER vitest disposes
// the jsdom `window` under full-suite parallelism, throwing
// `ReferenceError: window is not defined` from performWorkOnRootViaSchedulerTask
// and tripping `pnpm test` to a non-zero exit despite all assertions passing
// (#109). cleanup() unmounts synchronously, cancelling the pending scheduler
// task so nothing is left to fire at teardown.
afterEach(() => {
  cleanup()
})

describe('VendorSidebar i18n', () => {
  it('renders English nav labels when locale is en', () => {
    renderWithIntl(
      <VendorSidebar userName="Test Vendor" />,
      { locale: 'en', messages: enMessages },
    )

    expect(screen.getByText('Dashboard')).toBeInTheDocument()
    expect(screen.getByText('Listings')).toBeInTheDocument()
    expect(screen.getByText('Bookings')).toBeInTheDocument()
  })

  it('renders Hindi nav labels when locale is hi', () => {
    renderWithIntl(
      <VendorSidebar userName="Test Vendor" />,
      { locale: 'hi', messages: hiMessages },
    )

    expect(screen.getByText('डैशबोर्ड')).toBeInTheDocument()
    expect(screen.getByText('लिस्टिंग')).toBeInTheDocument()
    expect(screen.getByText('बुकिंग')).toBeInTheDocument()
  })

  it('renders portal title from translations', () => {
    renderWithIntl(
      <VendorSidebar userName="Test Vendor" />,
      { locale: 'hi', messages: hiMessages },
    )

    const portalTitles = screen.getAllByText('विक्रेता पोर्टल')
    expect(portalTitles.length).toBeGreaterThan(0)
  })

  it('renders complete setup CTA from translations', () => {
    renderWithIntl(
      <VendorSidebar userName="Test Vendor" />,
      { locale: 'hi', messages: hiMessages },
    )

    // Multiple CTA elements (desktop + mobile sidebar content)
    const ctaElements = screen.getAllByText('सेटअप पूरा करें')
    expect(ctaElements.length).toBeGreaterThan(0)
  })
})
