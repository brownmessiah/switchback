'use client'

import Link from 'next/link'
import { useTranslations } from 'next-intl'
import { usePathname } from 'next/navigation'

import {
  PortalNavDrawer,
  type PortalNavVariant,
} from '@/components/portal-nav-drawer'
import { ThemeToggle } from '@/components/theme-toggle'
import { cn } from '@/lib/utils'

import { VENDOR_NAV_ITEMS } from './vendor-nav'

interface VendorSidebarProps {
  readonly userName: string
}

// ──────────────────────────────────────────────────
//  Sidebar content (shared between drawer & rail)
// ──────────────────────────────────────────────────

function SidebarContent({
  variant,
  onNavigate,
}: {
  readonly variant: PortalNavVariant
  readonly onNavigate?: () => void
}) {
  const pathname = usePathname()
  const t = useTranslations('VendorNav')

  // The rail is an ICON-RAIL at `md` (icons only) widening to icons+labels at
  // `lg`; the drawer always shows icons+labels. So in the rail the label is
  // `hidden lg:inline` and the link centres until `lg`, while the drawer keeps
  // the full icon+label row at every width.
  const isRail = variant === 'rail'

  return (
    <div className="flex h-full flex-col">
      <nav className="flex-1 space-y-1 px-3 py-4">
        {VENDOR_NAV_ITEMS.map((item) => {
          const active = pathname.startsWith(item.href)
          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={onNavigate}
              title={isRail ? t(`items.${item.labelKey}`) : undefined}
              className={cn(
                'min-tap flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition',
                isRail && 'justify-center lg:justify-start',
                active
                  ? 'bg-primary/10 font-medium text-primary'
                  : 'text-muted-foreground hover:bg-muted hover:text-foreground',
              )}
            >
              <span className="w-5 text-center text-xs" aria-hidden="true">
                {item.icon}
              </span>
              <span className={cn(isRail && 'hidden lg:inline')}>
                {t(`items.${item.labelKey}`)}
              </span>
            </Link>
          )
        })}
      </nav>

      <div className={cn('border-t py-4', isRail ? 'px-3 lg:px-6' : 'px-6')}>
        <Link
          // A vendor only reaches this dashboard once a vendor_profiles row
          // exists (the (dashboard) layout gate, ADR-0006), so /vendor/onboarding
          // would redirect straight back — a silent no-op. The actionable
          // "finish your setup" step is KYC verification, in settings.
          href="/vendor/settings#verification"
          onClick={onNavigate}
          title={isRail ? t('completeSetup') : undefined}
          className={cn(
            'block rounded-lg bg-primary px-4 py-2 text-center text-sm font-medium text-primary-foreground hover:bg-primary/90',
            isRail && 'truncate',
          )}
        >
          {/* Icon-rail (md): a compact "+" affordance; labelled at lg and in the
              drawer. */}
          {isRail ? (
            <>
              <span className="lg:hidden" aria-hidden="true">
                ＋
              </span>
              <span className="hidden lg:inline">{t('completeSetup')}</span>
            </>
          ) : (
            t('completeSetup')
          )}
        </Link>
      </div>
    </div>
  )
}

// ──────────────────────────────────────────────────
//  Main exported component
// ──────────────────────────────────────────────────

/**
 * Vendor portal sidebar. Built on the shared {@link PortalNavDrawer} (Sheet-based
 * — focus-trap / Escape / restore for free): a hamburger-opened LEFT drawer
 * below `md`, a persistent rail at `md+`. Vendor nav has per-item icons, so the
 * rail is an **icon-rail at `md`** (icons only, `w-16`) widening to
 * **icons+labels at `lg`** (`w-64`); the drawer always shows icons+labels
 * (DESIGN.md §8.3 / §8.5, ADR-0018).
 */
export function VendorSidebar({ userName }: VendorSidebarProps) {
  const t = useTranslations('VendorNav')
  const tNav = useTranslations('Nav')

  const portalTitle = t('portalTitle')

  return (
    <PortalNavDrawer
      title={portalTitle}
      openMenuLabel={tNav('openMenu')}
      menuDescription={portalTitle}
      themeToggle={<ThemeToggle label={tNav('themeToggle')} />}
      // Icon-rail at md (w-16) → icons+labels at lg (w-64). bg-muted/30 preserves
      // the prior vendor rail surface.
      railClassName="w-16 bg-muted/30 lg:w-64"
      // The icon-rail (w-16) can't show the title text inline, so the rail header
      // is responsive: a centred theme toggle at md; title + name + toggle at lg.
      renderRailHeader={() => (
        <div className="flex items-center justify-between gap-2 border-b px-3 py-3 lg:px-6 lg:py-5">
          <div className="hidden min-w-0 lg:block">
            <p className="text-sm font-semibold">{portalTitle}</p>
            <p className="mt-0.5 truncate text-xs text-muted-foreground">{userName}</p>
          </div>
          <div className="mx-auto lg:mx-0">
            <ThemeToggle label={tNav('themeToggle')} />
          </div>
        </div>
      )}
    >
      {({ variant, onNavigate }) => (
        <SidebarContent variant={variant} onNavigate={onNavigate} />
      )}
    </PortalNavDrawer>
  )
}
