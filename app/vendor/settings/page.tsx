import { eq } from 'drizzle-orm'
import { headers } from 'next/headers'

import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { db } from '@/db/client'
import { vendorProfiles } from '@/db/schema/vendor-profiles'
import { auth } from '@/lib/auth'

import { BusinessDetailsForm } from './business-details-form'
import { KycDisplay } from './kyc-display'
import { PayoutMethodForm } from './payout-method-form'

export default async function VendorSettingsPage() {
  const session = await auth.api.getSession({ headers: await headers() })
  const userId = session!.user.id

  const [vendor] = await db
    .select()
    .from(vendorProfiles)
    .where(eq(vendorProfiles.userId, userId))
    .limit(1)

  if (!vendor) {
    return null // Layout guard should have redirected
  }

  const payoutDest =
    vendor.payoutDestination as Record<string, string> | null

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Manage your business details, payout method, and verification status.
        </p>
      </div>

      <Tabs defaultValue="business">
        <TabsList>
          <TabsTrigger value="business">Business details</TabsTrigger>
          <TabsTrigger value="payout">Payout method</TabsTrigger>
          <TabsTrigger value="kyc">KYC documents</TabsTrigger>
        </TabsList>

        <TabsContent value="business" className="mt-6">
          <BusinessDetailsForm
            initialBusinessName={vendor.businessName}
            initialSlug={vendor.slug}
            initialAbout={vendor.about}
          />
        </TabsContent>

        <TabsContent value="payout" className="mt-6">
          <PayoutMethodForm
            initialPayoutMethod={vendor.payoutMethod}
            initialPayoutDestination={payoutDest}
            payoutDestinationChangedAt={vendor.payoutDestinationChangedAt}
          />
        </TabsContent>

        <TabsContent value="kyc" className="mt-6">
          <KycDisplay
            kycTier={vendor.kycTier}
            pan={vendor.pan}
            gstin={vendor.gstin}
            udyamId={vendor.udyamId}
            aadhaarVerifiedAt={vendor.aadhaarVerifiedAt}
            videoCallVerifiedAt={vendor.videoCallVerifiedAt}
          />
        </TabsContent>
      </Tabs>
    </div>
  )
}
