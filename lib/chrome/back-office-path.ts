/**
 * Back-office path predicate for the consumer chrome (critique E).
 *
 * The consumer marketing SiteHeader + SiteFooter live in the ROOT layout, so
 * they would otherwise render inside the /admin and /vendor dashboards too.
 * They consult this predicate (via `usePathname()`) and render `null` on
 * back-office paths.
 *
 * The vendor DASHBOARD lives under specific prefixes; the PUBLIC vendor
 * storefront is `/vendor/<slug>` and must KEEP the consumer chrome — so the
 * match is against an explicit prefix allow-list, NOT a blanket `/vendor`.
 */

/** Exact prefixes whose pages are authenticated back-office (no consumer chrome). */
const BACK_OFFICE_PREFIXES = [
  '/admin',
  '/vendor/dashboard',
  '/vendor/listings',
  '/vendor/bookings',
  '/vendor/messages',
  '/vendor/onboarding',
  '/vendor/payouts',
  '/vendor/reviews',
  '/vendor/settings',
] as const

/**
 * True when `pathname` is an admin or vendor-dashboard back-office route. A
 * prefix matches only on a segment boundary (`/admin` or `/admin/...`), so
 * `/admins-club` and the public `/vendor/<slug>` storefront do NOT match.
 */
export function isBackOfficePath(pathname: string): boolean {
  return BACK_OFFICE_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  )
}
