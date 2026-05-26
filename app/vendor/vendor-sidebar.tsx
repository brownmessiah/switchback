'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

import { cn } from '@/lib/utils'

const NAV_ITEMS = [
  { href: '/vendor/dashboard', label: 'Dashboard', icon: '◻' },
  { href: '/vendor/listings', label: 'Listings', icon: '☰' },
  { href: '/vendor/bookings', label: 'Bookings', icon: '📋' },
  { href: '/vendor/payouts', label: 'Payouts', icon: '₹' },
]

interface VendorSidebarProps {
  userName: string
}

export function VendorSidebar({ userName }: VendorSidebarProps) {
  const pathname = usePathname()

  return (
    <aside className="hidden w-64 shrink-0 border-r bg-muted/30 lg:block">
      <div className="flex h-full flex-col">
        <div className="border-b px-6 py-5">
          <p className="text-sm font-semibold">Vendor Portal</p>
          <p className="mt-0.5 truncate text-xs text-muted-foreground">{userName}</p>
        </div>

        <nav className="flex-1 space-y-1 px-3 py-4">
          {NAV_ITEMS.map((item) => {
            const active = pathname.startsWith(item.href)
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  'flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition',
                  active
                    ? 'bg-primary/10 font-medium text-primary'
                    : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                )}
              >
                <span className="w-5 text-center text-xs">{item.icon}</span>
                {item.label}
              </Link>
            )
          })}
        </nav>

        <div className="border-t px-6 py-4">
          <Link
            href="/vendor/onboarding"
            className="block rounded-lg bg-primary px-4 py-2 text-center text-sm font-medium text-primary-foreground hover:bg-primary/90"
          >
            Complete setup
          </Link>
        </div>
      </div>
    </aside>
  )
}
