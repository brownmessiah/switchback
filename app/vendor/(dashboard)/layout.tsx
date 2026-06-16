import { headers } from 'next/headers'
import { redirect } from 'next/navigation'

import { auth } from '@/lib/auth'
import { getActingVendorContext } from '@/lib/vendor/acting-context'

import { VendorSidebar } from '../vendor-sidebar'

/**
 * Layout for the authenticated vendor dashboard surface.
 *
 * Resolves the acting Vendor context ONCE (issue #11, single-account model):
 * `getActingVendorContext` admits the Owner (own active `vendor_profiles` row,
 * ADR-0006) AND any active team member (resolved to the shop they belong to),
 * and redirects a profile-less non-member — or a closed-only profile with no
 * active membership — to /vendor/onboarding. Onboarding lives OUTSIDE this
 * route group, so the redirect does not loop.
 *
 * This subsumes the prior owner-only `requireVendorProfile` gate (#04/#05) and
 * the `bookings:read` belonging-bound (#03): an admitted context already proves
 * an active owner/member role; per-route gates still enforce narrower
 * permissions. For the single-seat Owner the resolved `vendorUserId` equals the
 * session id → zero behavior change.
 *
 * Auth (session presence) is also enforced by the parent `app/vendor/layout.tsx`;
 * we re-read the session here only for the sidebar display name (the `cache()`
 * wrapper dedups the session read with the gate's own).
 */
export default async function VendorDashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) {
    redirect('/sign-in')
  }

  // Single gate (issue #11): resolve { vendorUserId (shop), role }. Owner →
  // admitted (vendorUserId === session.user.id). Active member → admitted on
  // the shop they belong to. None → redirect to /vendor/onboarding (inside the
  // resolver). The resolved `role` drives sidebar nav-gating (§6); every route
  // re-enforces its own permission gate regardless of which links are shown.
  const { role } = await getActingVendorContext()

  // flex-col on mobile so the sticky mobile header bar (a VendorSidebar child)
  // stacks full-width on top instead of sitting as a row sibling that eats the
  // horizontal space and squeezes <main> (mobile h-overflow). md:flex-row docks
  // the rail beside <main> from the tablet tier (where the rail becomes visible
  // via md:block).
  return (
    <div className="flex min-h-[80vh] flex-col md:flex-row">
      <VendorSidebar userName={session.user.name ?? 'Vendor'} role={role} />
      {/* min-w-0 lets wide tables scroll inside their own overflow-x-auto wrapper
          instead of stretching the whole shell past the viewport (mirrors the
          admin shell fix). */}
      <main className="min-w-0 flex-1 px-4 py-8 sm:px-8 lg:px-12">{children}</main>
    </div>
  )
}
