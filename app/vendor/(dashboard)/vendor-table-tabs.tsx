import { CalendarCheck, Star, Wallet } from 'lucide-react'
import Link from 'next/link'

import { cn } from '@/lib/utils'

/**
 * Shared tri-tab shell for the three Vendor master-table routes
 * (archetype #54 direction B wrapped in A's tri-tab shell): Bookings ·
 * Payouts · Reviews.
 *
 * Each of the three is a SEPARATE route that still renders at its own URL —
 * this component is a navigation between them, NOT a single merged surface. It
 * renders the same nav on every route with the current one as the active tab.
 * Styled on the DESIGN.md §3 `line`-variant Tabs idiom (active = coral
 * `--primary-strong` ink + underline), each tab pairs an icon with its label.
 */

export type VendorTableTab = 'bookings' | 'payouts' | 'reviews'

const TABS: ReadonlyArray<{
  readonly key: VendorTableTab
  readonly href: string
  readonly label: string
  readonly Icon: typeof CalendarCheck
}> = [
  { key: 'bookings', href: '/vendor/bookings', label: 'Bookings', Icon: CalendarCheck },
  { key: 'payouts', href: '/vendor/payouts', label: 'Payouts', Icon: Wallet },
  { key: 'reviews', href: '/vendor/reviews', label: 'Reviews', Icon: Star },
]

interface VendorTableTabsProps {
  readonly active: VendorTableTab
}

export function VendorTableTabs({ active }: VendorTableTabsProps) {
  return (
    <nav
      data-testid="vendor-table-tabs"
      aria-label="Vendor records"
      className="flex w-fit items-center gap-1 border-b border-border"
    >
      {TABS.map(({ key, href, label, Icon }) => {
        const isActive = key === active
        return (
          <Link
            key={key}
            href={href}
            aria-current={isActive ? 'page' : undefined}
            className={cn(
              'inline-flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm font-medium transition-colors -mb-px',
              'focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50 rounded-t-md',
              isActive
                ? 'border-primary-strong text-primary-strong'
                : 'border-transparent text-muted-foreground hover:text-foreground',
            )}
          >
            <Icon className="size-4" aria-hidden="true" />
            {label}
          </Link>
        )
      })}
    </nav>
  )
}
