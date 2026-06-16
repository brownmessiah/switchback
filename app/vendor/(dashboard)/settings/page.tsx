import { eq } from 'drizzle-orm'

import { db } from '@/db/client'
import { vendorProfiles } from '@/db/schema/vendor-profiles'
import { getActingVendorContext } from '@/lib/vendor/acting-context'

import { BusinessDetailsForm } from './business-details-form'
import {
  getArchivableExperienceCount,
  getVendorClosureEligibility,
} from './close-account-core'
import { CloseAccountDangerZone } from './close-account-danger-zone'
import { KycDisplay } from './kyc-display'
import { PayoutMethodForm } from './payout-method-form'
import { SettingsAnchorNav } from './settings-anchor-nav'

/**
 * Vendor settings — #56 Direction B "Single-scroll trust ledger" (DESIGN.md
 * §4 A2 form + anchor-nav, §2 tokens, §5 AA+).
 *
 * Drops the as-is 3-Tabs shell for ONE single-scroll page with a sticky in-page
 * anchor-nav rail (Business details · Payout method · Verification), mirroring
 * the PDP anchor-nav pattern (plain `<a href="#…">` + section `id`s +
 * `scroll-mt-[var(--header-offset)]`, SSR-compatible, no client JS for nav).
 *
 * The 7-day bank-change cooling-off (ADR-0016) is realized as a LIVE, trackable
 * countdown object inside the payout section — see `payout-method-form.tsx`.
 */
export default async function VendorSettingsPage() {
  // Resolve the acting shop (issue #11): settings show the shop's profile,
  // payout method, and verification, keyed on the resolved `vendorUserId`. A
  // member sees their account's settings (per-section actions still gate the
  // narrower write permissions — only the Owner can edit bank / close).
  const { vendorUserId } = await getActingVendorContext()

  const [vendor] = await db
    .select()
    .from(vendorProfiles)
    .where(eq(vendorProfiles.userId, vendorUserId))
    .limit(1)

  if (!vendor) {
    return null // Layout guard should have redirected
  }

  const payoutDest =
    vendor.payoutDestination as Record<string, string> | null

  // Server-compute closure eligibility from real Bookings/Payout state, plus
  // the count of Experiences that closure WILL archive (status != 'archived',
  // matching the archive query) for the dialog consequence copy. Never trusted
  // from the client (issue 06).
  const eligibility = await getVendorClosureEligibility(db, vendorUserId)
  const archivableExperienceCount = await getArchivableExperienceCount(db, vendorUserId)

  const sections = [
    { id: 'business-details', label: 'Business details' },
    { id: 'payout-method', label: 'Payout method' },
    { id: 'verification', label: 'Verification' },
    { id: 'danger-zone', label: 'Account' },
  ] as const

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-semibold tracking-tight">
          Settings
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Manage your business details, payout method, and verification status.
        </p>
      </div>

      {/* Single-scroll trust ledger: sticky anchor rail + inline sections. On
          ≥lg the rail sits in a left column; below that it stacks above. */}
      <div className="lg:grid lg:grid-cols-[12rem_minmax(0,1fr)] lg:gap-8">
        <SettingsAnchorNav label="Settings sections" items={sections} />

        <div className="space-y-[var(--space-section)]">
          <section
            id="business-details"
            className="scroll-mt-[calc(var(--header-offset,4rem)+1rem)]"
          >
            <BusinessDetailsForm
              initialBusinessName={vendor.businessName}
              initialSlug={vendor.slug}
              initialAbout={vendor.about}
            />
          </section>

          <section
            id="payout-method"
            className="scroll-mt-[calc(var(--header-offset,4rem)+1rem)]"
          >
            <PayoutMethodForm
              initialPayoutMethod={vendor.payoutMethod}
              initialPayoutDestination={payoutDest}
              payoutDestinationChangedAt={vendor.payoutDestinationChangedAt}
            />
          </section>

          <section
            id="verification"
            className="scroll-mt-[calc(var(--header-offset,4rem)+1rem)]"
          >
            <KycDisplay
              kycTier={vendor.kycTier}
              pan={vendor.pan}
              gstin={vendor.gstin}
              udyamId={vendor.udyamId}
              aadhaarVerifiedAt={vendor.aadhaarVerifiedAt}
              videoCallVerifiedAt={vendor.videoCallVerifiedAt}
            />
          </section>

          <section
            id="danger-zone"
            className="scroll-mt-[calc(var(--header-offset,4rem)+1rem)]"
          >
            <CloseAccountDangerZone
              eligibility={{
                canClose: eligibility.canClose,
                inFlightCount: eligibility.inFlightCount,
                unsettledDuesCount: eligibility.unsettledDuesCount,
                archivableExperienceCount,
                suspended: vendor.suspended,
              }}
            />
          </section>
        </div>
      </div>
    </div>
  )
}
