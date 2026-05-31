'use client'

import { useCallback, useEffect, useState } from 'react'

import Link from 'next/link'
import { useTranslations } from 'next-intl'
import { usePathname } from 'next/navigation'

import { cn } from '@/lib/utils'

import type { AdminNavGroup } from './admin-nav'

/** Badge counts keyed by badgeKey from AdminNavItem. */
export interface AdminBadgeCounts {
  readonly pendingKyc?: number
  readonly pendingExperiences?: number
  readonly disputedBookings?: number
}

interface AdminSidebarProps {
  /** Navigation groups already filtered by the admin's permissions. */
  readonly groups: readonly AdminNavGroup[]
  /** Badge counts for pending items. */
  readonly badgeCounts?: AdminBadgeCounts
}

// ──────────────────────────────────────────────────
//  Sidebar content (shared between desktop & mobile)
// ──────────────────────────────────────────────────

function SidebarContent({
  groups,
  badgeCounts,
  onNavigate,
}: AdminSidebarProps & { readonly onNavigate?: () => void }) {
  const pathname = usePathname()
  const t = useTranslations('AdminNav')

  // A group is open if it contains the active route, or user toggled it
  const [openGroups, setOpenGroups] = useState<Set<string>>(() => {
    const initial = new Set<string>()
    for (const group of groups) {
      for (const item of group.items) {
        if (pathname.startsWith(item.href)) {
          initial.add(group.label)
          break
        }
      }
    }
    return initial
  })

  const toggleGroup = useCallback((label: string) => {
    setOpenGroups((prev) => {
      const next = new Set(prev)
      if (next.has(label)) {
        next.delete(label)
      } else {
        next.add(label)
      }
      return next
    })
  }, [])

  // Ensure active group stays open on route change
  useEffect(() => {
    for (const group of groups) {
      for (const item of group.items) {
        if (pathname.startsWith(item.href)) {
          setOpenGroups((prev) => {
            if (prev.has(group.label)) return prev
            const next = new Set(prev)
            next.add(group.label)
            return next
          })
          break
        }
      }
    }
  }, [pathname, groups])

  return (
    <nav className="flex flex-col gap-1 py-2">
      {groups.map((group) => {
        const isOpen = openGroups.has(group.label)
        const groupLabel = t(`groups.${group.labelKey}`)
        return (
          <div key={group.label}>
            <button
              type="button"
              onClick={() => toggleGroup(group.label)}
              className="flex w-full items-center justify-between px-3 py-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground hover:text-foreground"
              aria-expanded={isOpen}
            >
              <span>{groupLabel}</span>
              <ChevronIcon open={isOpen} />
            </button>

            {isOpen && (
              <div className="flex flex-col gap-0.5 pb-2">
                {group.items.map((item) => {
                  const isActive = pathname.startsWith(item.href)
                  const badge =
                    item.badgeKey && badgeCounts
                      ? (badgeCounts as Record<string, number | undefined>)[item.badgeKey]
                      : undefined
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      onClick={onNavigate}
                      className={cn(
                        'mx-2 flex items-center justify-between rounded-md px-3 py-1.5 text-sm transition-colors',
                        isActive
                          ? 'bg-primary/10 font-medium text-primary'
                          : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                      )}
                    >
                      <span>{t(`items.${item.labelKey}`)}</span>
                      {badge != null && badge > 0 && (
                        <span className="ml-2 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-destructive px-1.5 text-xs font-medium text-destructive-foreground">
                          {badge}
                        </span>
                      )}
                    </Link>
                  )
                })}
              </div>
            )}
          </div>
        )
      })}
    </nav>
  )
}

// ──────────────────────────────────────────────────
//  Chevron icon (rotates when open)
// ──────────────────────────────────────────────────

function ChevronIcon({ open }: { readonly open: boolean }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={cn('transition-transform', open ? 'rotate-180' : '')}
      aria-hidden="true"
    >
      <path d="m6 9 6 6 6-6" />
    </svg>
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

export function AdminSidebar({ groups, badgeCounts }: AdminSidebarProps) {
  const [mobileOpen, setMobileOpen] = useState(false)
  const t = useTranslations('AdminNav')

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

  const sidebarTitle = t('sidebarTitle')

  return (
    <>
      {/* Mobile header bar */}
      <div className="sticky top-0 z-40 flex items-center gap-3 border-b bg-background px-4 py-3 lg:hidden">
        <button
          type="button"
          onClick={() => setMobileOpen(true)}
          className="inline-flex items-center justify-center rounded-md p-1 text-muted-foreground hover:text-foreground"
          aria-label="Open admin menu"
        >
          <HamburgerIcon />
        </button>
        <span className="text-sm font-semibold text-primary">{sidebarTitle}</span>
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
              <span className="text-sm font-semibold text-primary">{sidebarTitle}</span>
              <button
                type="button"
                onClick={() => setMobileOpen(false)}
                className="inline-flex items-center justify-center rounded-md p-1 text-muted-foreground hover:text-foreground"
                aria-label="Close admin menu"
              >
                <CloseIcon />
              </button>
            </div>
            <div className="overflow-y-auto" style={{ maxHeight: 'calc(100vh - 57px)' }}>
              <SidebarContent
                groups={groups}
                badgeCounts={badgeCounts}
                onNavigate={() => setMobileOpen(false)}
              />
            </div>
          </div>
        </div>
      )}

      {/* Desktop sidebar */}
      <aside className="hidden w-60 shrink-0 border-r bg-background lg:block">
        <div className="sticky top-0 overflow-y-auto" style={{ maxHeight: '100vh' }}>
          <div className="border-b px-4 py-3">
            <span className="text-sm font-semibold text-primary">{sidebarTitle}</span>
          </div>
          <SidebarContent groups={groups} badgeCounts={badgeCounts} />
        </div>
      </aside>
    </>
  )
}
