'use client'

import { useState, type ReactNode } from 'react'

import { Menu } from 'lucide-react'
import { usePathname } from 'next/navigation'

import { Button } from '@/components/ui/button'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet'
import { cn } from '@/lib/utils'

/**
 * Which surface the nav content is being rendered into. The same nav markup is
 * rendered three times by a portal sidebar — once in the mobile `Sheet`
 * (`drawer`) and once in the persistent `aside` (`rail`) — so consumers tier
 * their styling off this and wire `onNavigate` (close-the-drawer) only on the
 * Sheet copy.
 */
export type PortalNavVariant = 'drawer' | 'rail'

export interface PortalNavRenderContext {
  /** Where this nav tree is mounted: the mobile Sheet or the persistent rail. */
  readonly variant: PortalNavVariant
  /**
   * Present only for the `drawer` variant — call it from each nav link's
   * `onClick` so tapping a link inside the open Sheet closes it. (Route-change
   * close is handled centrally, but firing this on tap closes instantly without
   * waiting for the pathname effect.)
   */
  readonly onNavigate?: () => void
}

interface PortalNavDrawerProps {
  /** Already-translated portal title (e.g. "Admin", "Vendor Portal"). */
  readonly title: string
  /** Already-translated accessible label for the mobile hamburger trigger. */
  readonly openMenuLabel: string
  /**
   * Screen-reader description for the mobile Sheet (Base UI Dialog requires a
   * description for an axe-clean labelled dialog). Already translated.
   */
  readonly menuDescription: string
  /** The dark/light theme toggle, rendered into both the top-bar and rail header. */
  readonly themeToggle: ReactNode
  /**
   * Optional override for the persistent rail's header (`md+`). The vendor
   * icon-rail (`w-16` at `md`) cannot show the title text + toggle inline, so it
   * supplies its own responsive header here; admin omits this and gets the
   * default title + toggle row. The drawer header is always the default
   * (title + toggle), independent of this.
   */
  readonly renderRailHeader?: () => ReactNode
  /** Tailwind width/utility classes for the persistent `aside` rail. */
  readonly railClassName?: string
  /** Render-prop returning the nav tree for a given surface (drawer | rail). */
  readonly children: (ctx: PortalNavRenderContext) => ReactNode
}

/**
 * Shared Sheet-based portal nav shell for the back-office surfaces
 * (DESIGN.md §8.5 item 3, ADR-0018). Replaces the two hand-rolled
 * fixed-overlay drawers in `admin-sidebar.tsx` / `vendor-sidebar.tsx`,
 * gaining the focus-trap / Escape / restore parity the filter Sheet already
 * has — for free, via the `Sheet` primitive (Base UI Dialog).
 *
 * Tier behaviour (no breakpoint overrides — Tailwind v4 defaults):
 *   - **base `< md`**: a sticky top-bar with a hamburger that opens a LEFT Sheet.
 *   - **`md+`**: a persistent `aside` rail; the top-bar + Sheet are hidden.
 *
 * The rail's width/density (icon-rail at `md` → label rail at `lg`, or a compact
 * text rail) is the consumer's concern via `railClassName` + the render-prop's
 * `variant`, so this shell stays portal-agnostic.
 */
export function PortalNavDrawer({
  title,
  openMenuLabel,
  menuDescription,
  themeToggle,
  renderRailHeader,
  railClassName,
  children,
}: PortalNavDrawerProps) {
  const [mobileOpen, setMobileOpen] = useState(false)
  const pathname = usePathname()

  // Close the mobile drawer whenever the route changes (e.g. a link tap that
  // the Sheet's own close didn't catch, or a programmatic navigation). The
  // Sheet primitive owns focus-restore on close. Tracked as previous-value-in-
  // state + a render-time reconcile (loop-guarded by the pathname comparison)
  // instead of an effect, so React's set-state-in-effect lint stays clean.
  const [prevPathname, setPrevPathname] = useState(pathname)
  if (prevPathname !== pathname) {
    setPrevPathname(pathname)
    if (mobileOpen) setMobileOpen(false)
  }

  const closeDrawer = () => setMobileOpen(false)

  return (
    <>
      {/* Mobile top-bar — base `< md` only. The persistent rail replaces it at md+. */}
      <div
        data-slot="portal-nav-topbar"
        className="sticky top-0 z-40 flex items-center gap-3 border-b bg-background px-4 py-3 md:hidden"
      >
        <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
          <SheetTrigger
            render={
              <Button
                variant="ghost"
                size="icon"
                aria-label={openMenuLabel}
              />
            }
          >
            <Menu aria-hidden="true" />
          </SheetTrigger>
          <SheetContent
            side="left"
            className="w-[min(20rem,90vw)] gap-0 overflow-y-auto p-0"
            aria-label={title}
          >
            <SheetHeader className="flex flex-row items-center justify-between gap-2 border-b px-4 py-3">
              <SheetTitle className="text-sm font-semibold text-primary">
                {title}
              </SheetTitle>
              <SheetDescription className="sr-only">
                {menuDescription}
              </SheetDescription>
              {/* Theme toggle sits inline; the Sheet's own close button is the
                  absolute top-right control supplied by the primitive. */}
              <span className="pr-8">{themeToggle}</span>
            </SheetHeader>
            {children({ variant: 'drawer', onNavigate: closeDrawer })}
          </SheetContent>
        </Sheet>
        <span className="text-sm font-semibold text-primary">{title}</span>
      </div>

      {/* Persistent rail — md+. Width/density owned by the consumer. */}
      <aside
        data-slot="portal-nav-rail"
        className={cn(
          'hidden shrink-0 border-r bg-background md:block',
          railClassName,
        )}
      >
        <div className="sticky top-0 max-h-screen overflow-y-auto">
          {renderRailHeader ? (
            renderRailHeader()
          ) : (
            <div className="flex items-center justify-between gap-2 border-b px-4 py-3">
              <span className="truncate text-sm font-semibold text-primary">
                {title}
              </span>
              {themeToggle}
            </div>
          )}
          {children({ variant: 'rail' })}
        </div>
      </aside>
    </>
  )
}
