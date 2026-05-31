/**
 * Tests for AdminSidebar i18n integration.
 *
 * Verifies that the admin sidebar renders translated labels via
 * useTranslations('AdminNav') when wrapped with NextIntlClientProvider.
 */

import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import enMessages from '@/lib/i18n/messages/en.json'
import hiMessages from '@/lib/i18n/messages/hi.json'

import type { AdminNavGroup } from './admin-nav'
import { AdminSidebar } from './admin-sidebar'

// Mock next/navigation
vi.mock('next/navigation', () => ({
  usePathname: () => '/admin/dashboard',
}))

/**
 * Wrapper that provides NextIntlClientProvider with the given locale/messages.
 * Uses the real NextIntlClientProvider from next-intl.
 */
function renderWithIntl(
  ui: React.ReactElement,
  { locale, messages }: { locale: string; messages: Record<string, unknown> },
) {
  // next-intl's NextIntlClientProvider requires React context
  // For unit tests, we use the actual provider
  const { NextIntlClientProvider } = require('next-intl')
  return render(
    <NextIntlClientProvider locale={locale} messages={messages}>
      {ui}
    </NextIntlClientProvider>,
  )
}

// Unmount every rendered tree after each test. AdminSidebar is a 'use client'
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

const TEST_GROUPS: readonly AdminNavGroup[] = [
  {
    label: 'Dashboard',
    labelKey: 'dashboard',
    items: [
      { href: '/admin/dashboard', label: 'Overview', labelKey: 'overview', permission: 'overview' },
      { href: '/admin/analytics', label: 'Analytics', labelKey: 'analytics', permission: 'analytics' },
    ],
  },
  {
    label: 'Marketplace',
    labelKey: 'marketplace',
    items: [
      { href: '/admin/vendors', label: 'Vendors', labelKey: 'vendors', permission: 'vendors', badgeKey: 'pendingKyc' },
    ],
  },
]

describe('AdminSidebar i18n', () => {
  it('renders English nav labels when locale is en', () => {
    renderWithIntl(
      <AdminSidebar groups={TEST_GROUPS} badgeCounts={{}} />,
      { locale: 'en', messages: enMessages },
    )

    // Group labels should be translated
    expect(screen.getByText('Dashboard')).toBeInTheDocument()
    // Item labels should be translated
    expect(screen.getByText('Overview')).toBeInTheDocument()
  })

  it('renders Hindi nav labels when locale is hi', () => {
    renderWithIntl(
      <AdminSidebar groups={TEST_GROUPS} badgeCounts={{}} />,
      { locale: 'hi', messages: hiMessages },
    )

    // Group labels should be in Hindi
    expect(screen.getByText('डैशबोर्ड')).toBeInTheDocument()
    // Item labels should be in Hindi
    expect(screen.getByText('अवलोकन')).toBeInTheDocument()
  })

  it('renders sidebar title from translations', () => {
    renderWithIntl(
      <AdminSidebar groups={TEST_GROUPS} badgeCounts={{}} />,
      { locale: 'hi', messages: hiMessages },
    )

    // The sidebar title "Admin" should be translated to Hindi
    const adminTitles = screen.getAllByText('व्यवस्थापक')
    expect(adminTitles.length).toBeGreaterThan(0)
  })
})
