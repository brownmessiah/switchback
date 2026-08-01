import { and, eq, isNull } from 'drizzle-orm'
import { headers } from 'next/headers'
import { redirect } from 'next/navigation'

import { db } from '@/db/client'
import { vendorProfiles } from '@/db/schema'
import { auth } from '@/lib/auth'

import { OnboardingForm } from './onboarding-form'

export default async function VendorOnboardingPage() {
  const session = await auth.api.getSession({ headers: await headers() })
  const userId = session!.user.id

  // "Is an active Vendor" means an OPEN profile — closed_at IS NULL — the same
  // predicate lib/auth/permissions.ts uses. Without it a soft-closed Vendor
  // bounces forever: the dashboard sends them here, and here sent them back.
  // Falling through to the wizard lets them re-onboard, which
  // executeCreateVendorProfile handles as a reactivation.
  const [existing] = await db
    .select({ userId: vendorProfiles.userId })
    .from(vendorProfiles)
    .where(and(eq(vendorProfiles.userId, userId), isNull(vendorProfiles.closedAt)))
    .limit(1)

  if (existing) {
    redirect('/vendor/dashboard')
  }

  return (
    <div className="mx-auto max-w-xl space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">
          Become a vendor
        </h1>
        <p className="mt-1 text-muted-foreground">
          Set up your vendor profile to start listing adventure experiences on Outvers.
        </p>
      </div>

      <OnboardingForm userId={userId} />
    </div>
  )
}
