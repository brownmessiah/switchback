import { headers } from 'next/headers'
import { redirect } from 'next/navigation'

import { db } from '@/db/client'
import { auth } from '@/lib/auth'
import { requireVendorProfile } from '@/lib/auth/permissions'

import { VendorSidebar } from '../vendor-sidebar'

/**
 * Layout for the authenticated vendor dashboard surface.
 *
 * Gates on the existence of a `vendor_profiles` row (ADR-0006): a
 * signed-up user without a profile is redirected to /vendor/onboarding.
 * Onboarding lives OUTSIDE this route group, so it is not subject to
 * this gate (which would otherwise loop indefinitely).
 *
 * Auth (session presence) is already enforced by the parent
 * `app/vendor/layout.tsx`; we re-read the session here only to obtain
 * the user id + display name for the gate and sidebar.
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

  // Gate: user must have a vendor_profiles row. Redirects to
  // /vendor/onboarding if no vendor profile exists (per ADR-0006).
  await requireVendorProfile(db, session.user.id)

  return (
    <div className="flex min-h-[80vh]">
      <VendorSidebar userName={session.user.name ?? 'Vendor'} />
      <main className="flex-1 px-4 py-8 sm:px-8 lg:px-12">{children}</main>
    </div>
  )
}
