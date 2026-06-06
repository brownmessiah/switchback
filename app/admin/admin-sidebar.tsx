'use client'

import { useCallback, useEffect, useState } from 'react'

import Link from 'next/link'
import { useTranslations } from 'next-intl'
import { usePathname } from 'next/navigation'

import { PortalNavDrawer } from '@/components/portal-nav-drawer'
import { ThemeToggle } from '@/components/theme-toggle'
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
//  Sidebar content (shared between drawer & rail)
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
              className="min-tap flex w-full items-center justify-between px-3 py-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground hover:text-foreground"
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
                        'min-tap mx-2 flex items-center justify-between rounded-md px-3 py-1.5 text-sm transition-colors',
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
//  Main exported component
// ──────────────────────────────────────────────────

/**
 * Admin portal sidebar. Built on the shared {@link PortalNavDrawer} (Sheet-based
 * — focus-trap / Escape / restore for free): a hamburger-opened LEFT drawer
 * below `md`, a persistent rail at `md+`. Admin nav is grouped TEXT (no per-item
 * icons), so the rail is a **compact text rail at `md`** (`w-52`) widening to the
 * **full rail at `lg`** (`w-60`); the collapsible groups + badge counts ride at
 * every tier (DESIGN.md §8.3 / §8.5, ADR-0018).
 */
export function AdminSidebar({ groups, badgeCounts }: AdminSidebarProps) {
  const t = useTranslations('AdminNav')
  const tNav = useTranslations('Nav')

  const sidebarTitle = t('sidebarTitle')

  return (
    <PortalNavDrawer
      title={sidebarTitle}
      openMenuLabel={tNav('openMenu')}
      menuDescription={sidebarTitle}
      themeToggle={<ThemeToggle label={tNav('themeToggle')} />}
      // Compact text rail at md → full at lg. No per-item icons, so width is the
      // only tier difference; the grouped/collapsible content is identical.
      railClassName="w-52 lg:w-60"
    >
      {({ onNavigate }) => (
        <SidebarContent groups={groups} badgeCounts={badgeCounts} onNavigate={onNavigate} />
      )}
    </PortalNavDrawer>
  )
}
