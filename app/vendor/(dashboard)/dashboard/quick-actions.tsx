import { CalendarRange, ChevronRight, ClipboardList, type LucideIcon, Plus, Wallet } from 'lucide-react'
import { useTranslations } from 'next-intl'
import Link from 'next/link'

/**
 * Vendor dashboard quick-action cards (#04).
 *
 * A compact wayfinding row linking to the highest-frequency Vendor surfaces.
 * One reusable card (icon + label + chevron) repeated for all four targets —
 * no per-card bespoke markup. Labels are next-intl keys (VendorQuickActions);
 * styling uses theme-aware semantic tokens only (ADR-0018, no dark skin / hex).
 *
 * Domain vocab (CONTEXT.md): "Add Experience" (not Listing), "View Bookings"
 * (not Reservations). "Manage Availability" routes to the Experiences list —
 * availability is set per-Experience; there is no top-level availability route.
 */

interface QuickAction {
  readonly href: string
  readonly icon: LucideIcon
  /** Key under the VendorQuickActions namespace. */
  readonly labelKey: 'addExperience' | 'viewBookings' | 'manageAvailability' | 'viewEarnings'
}

const QUICK_ACTIONS: readonly QuickAction[] = [
  { href: '/vendor/listings/new', icon: Plus, labelKey: 'addExperience' },
  { href: '/vendor/bookings', icon: ClipboardList, labelKey: 'viewBookings' },
  // Availability is set per-Experience → route to the Experiences list.
  { href: '/vendor/listings', icon: CalendarRange, labelKey: 'manageAvailability' },
  { href: '/vendor/payouts', icon: Wallet, labelKey: 'viewEarnings' },
]

/**
 * A single quick-action card. The whole card is the link (large tap target).
 * Icons are decorative (aria-hidden) — the accessible name is the visible label.
 */
function QuickActionCard({ href, icon: Icon, label }: { href: string; icon: LucideIcon; label: string }) {
  return (
    <Link
      href={href}
      className="min-tap group flex items-center gap-3 rounded-xl bg-card px-4 py-3 text-sm text-card-foreground ring-1 ring-foreground/10 transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <Icon aria-hidden="true" className="size-5 shrink-0 text-muted-foreground group-hover:text-accent-foreground" />
      <span className="min-w-0 flex-1 truncate font-medium">{label}</span>
      <ChevronRight
        aria-hidden="true"
        data-testid="quick-action-chevron"
        className="size-4 shrink-0 text-muted-foreground"
      />
    </Link>
  )
}

/**
 * The quick-action row. Wraps/stacks per ADR-0018 §8.1: 2-up at the base
 * (phone) width, flipping to 4-up at md: (never sm:). Reuses the dashboard's
 * gap idiom and card border-radius/ring tokens.
 */
export function VendorQuickActions() {
  const t = useTranslations('VendorQuickActions')

  return (
    <section aria-label={t('heading')} className="space-y-3">
      <h2 className="text-sm font-medium text-muted-foreground">{t('heading')}</h2>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 md:gap-4">
        {QUICK_ACTIONS.map((action) => (
          <QuickActionCard
            key={action.href}
            href={action.href}
            icon={action.icon}
            label={t(action.labelKey)}
          />
        ))}
      </div>
    </section>
  )
}
