'use client'

import { useEffect, useState } from 'react'

import Link from 'next/link'
import { useTranslations } from 'next-intl'
import { usePathname } from 'next/navigation'

import { ThemeToggle } from '@/components/theme-toggle'
import { cn } from '@/lib/utils'

import { VENDOR_NAV_ITEMS } from './vendor-nav'

interface VendorSidebarProps {
  readonly userName: string
}

// ──────────────────────────────────────────────────
//  Sidebar content (shared between desktop & mobile)
// ──────────────────────────────────────────────────

function SidebarContent({
  userName,
  onNavigate,
}: {
  readonly userName: string
  readonly onNavigate?: () => void
}) {
  const pathname = usePathname()
  const t = useTranslations('VendorNav')
  const tNav = useTranslations('Nav')

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-start justify-between gap-2 border-b px-6 py-5">
        <div className="min-w-0">
          <p className="text-sm font-semibold">{t('portalTitle')}</p>
          <p className="mt-0.5 truncate text-xs text-muted-foreground">{userName}</p>
        </div>
        <ThemeToggle label={tNav('themeToggle')} />
      </div>

      <nav className="flex-1 space-y-1 px-3 py-4">
        {VENDOR_NAV_ITEMS.map((item) => {
          const active = pathname.startsWith(item.href)
          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={onNavigate}
              className={cn(
                'flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition',
                active
                  ? 'bg-primary/10 font-medium text-primary'
                  : 'text-muted-foreground hover:bg-muted hover:text-foreground',
              )}
            >
              <span className="w-5 text-center text-xs">{item.icon}</span>
              {t(`items.${item.labelKey}`)}
            </Link>
          )
        })}
      </nav>

      <div className="border-t px-6 py-4">
        <Link
          href="/vendor/onboarding"
          onClick={onNavigate}
          className="block rounded-lg bg-primary px-4 py-2 text-center text-sm font-medium text-primary-foreground hover:bg-primary/90"
        >
          {t('completeSetup')}
        </Link>
      </div>
    </div>
  )
}

// ──────────────────────────────────────────────────
//  Hamburger icon
// ──────────────────────────────────────────────────

function HamburgerIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <line x1="4" x2="20" y1="12" y2="12" />
      <line x1="4" x2="20" y1="6" y2="6" />
      <line x1="4" x2="20" y1="18" y2="18" />
    </svg>
  )
}

// ──────────────────────────────────────────────────
//  Close icon
// ──────────────────────────────────────────────────

function CloseIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M18 6 6 18" />
      <path d="m6 6 12 12" />
    </svg>
  )
}

// ──────────────────────────────────────────────────
//  Main exported component
// ──────────────────────────────────────────────────

export function VendorSidebar({ userName }: VendorSidebarProps) {
  const [mobileOpen, setMobileOpen] = useState(false)
  const t = useTranslations('VendorNav')
  const tNav = useTranslations('Nav')

  // Close mobile sidebar on route change
  const pathname = usePathname()
  useEffect(() => {
    setMobileOpen(false)
  }, [pathname])

  // Prevent body scroll when mobile sidebar is open
  useEffect(() => {
    if (mobileOpen) {
      document.body.style.overflow = 'hidden'
    } else {
      document.body.style.overflow = ''
    }
    return () => {
      document.body.style.overflow = ''
    }
  }, [mobileOpen])

  const portalTitle = t('portalTitle')

  return (
    <>
      {/* Mobile header bar */}
      <div className="sticky top-0 z-40 flex items-center gap-3 border-b bg-background px-4 py-3 lg:hidden">
        <button
          type="button"
          onClick={() => setMobileOpen(true)}
          className="inline-flex items-center justify-center rounded-md p-1 text-muted-foreground hover:text-foreground"
          aria-label="Open vendor menu"
        >
          <HamburgerIcon />
        </button>
        <span className="text-sm font-semibold text-primary">{portalTitle}</span>
        <ThemeToggle label={tNav('themeToggle')} className="ml-auto" />
      </div>

      {/* Mobile overlay */}
      {mobileOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          {/* Backdrop */}
          <div
            className="absolute inset-0 bg-black/50"
            onClick={() => setMobileOpen(false)}
            aria-hidden="true"
          />
          {/* Sidebar panel */}
          <div className="absolute inset-y-0 left-0 w-72 bg-background shadow-lg">
            <div className="flex items-center justify-between border-b px-4 py-3">
              <span className="text-sm font-semibold text-primary">{portalTitle}</span>
              <button
                type="button"
                onClick={() => setMobileOpen(false)}
                className="inline-flex items-center justify-center rounded-md p-1 text-muted-foreground hover:text-foreground"
                aria-label="Close vendor menu"
              >
                <CloseIcon />
              </button>
            </div>
            <div className="overflow-y-auto" style={{ maxHeight: 'calc(100vh - 57px)' }}>
              <SidebarContent userName={userName} onNavigate={() => setMobileOpen(false)} />
            </div>
          </div>
        </div>
      )}

      {/* Desktop sidebar */}
      <aside className="hidden w-64 shrink-0 border-r bg-muted/30 lg:block">
        <div className="sticky top-0 overflow-y-auto" style={{ maxHeight: '100vh' }}>
          <SidebarContent userName={userName} />
        </div>
      </aside>
    </>
  )
}
