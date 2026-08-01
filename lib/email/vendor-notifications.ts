import { eq } from 'drizzle-orm'

import { users } from '@/db/schema/users'
import { vendorProfiles } from '@/db/schema/vendor-profiles'
import type { DBOrTx } from '@/lib/payments/commission-resolver'

import {
  sendVendorApplicationReceivedEmail,
  sendVendorKycDecisionEmail,
  type VendorEmailSender,
} from './vendor-lifecycle'

/**
 * Wiring between a Vendor lifecycle event and the email content in
 * ./vendor-lifecycle. Callers hold only a `vendorUserId`, so the recipient is
 * resolved here.
 *
 * Everything is BEST-EFFORT and returns void: the onboarding insert or the
 * KYC decision has already committed by the time these run, so a missing
 * address or a dead provider is logged, never propagated. That is the same
 * guarantee `safeNotify` gives the money path.
 */

interface VendorRecipient {
  email: string
  businessName: string
}

async function loadRecipient(
  db: DBOrTx,
  vendorUserId: string,
): Promise<VendorRecipient | null> {
  const [row] = await db
    .select({
      email: users.email,
      businessName: vendorProfiles.businessName,
    })
    .from(vendorProfiles)
    .innerJoin(users, eq(vendorProfiles.userId, users.id))
    .where(eq(vendorProfiles.userId, vendorUserId))
    .limit(1)

  if (!row?.email) return null
  return { email: row.email, businessName: row.businessName }
}

function logFailure(label: string, detail: string): void {
  console.error(`[vendor-email] ${label} not sent: ${detail}`)
}

/**
 * Confirm to a freshly-onboarded Vendor that their account exists and that a
 * review is pending. This is the "email on signup" from the Vendor's point of
 * view — it fires at the moment they become a Vendor.
 */
export async function notifyVendorApplicationReceived(
  db: DBOrTx,
  sender: VendorEmailSender,
  vendorUserId: string,
): Promise<void> {
  try {
    const recipient = await loadRecipient(db, vendorUserId)
    if (!recipient) {
      logFailure('application-received', `no email on record for ${vendorUserId}`)
      return
    }

    const result = await sendVendorApplicationReceivedEmail(sender, {
      to: recipient.email,
      businessName: recipient.businessName,
    })
    if (!result.ok) logFailure('application-received', result.error)
  } catch (err: unknown) {
    logFailure('application-received', err instanceof Error ? err.message : String(err))
  }
}

export type KycDecisionDetail =
  | { decision: 'approved'; tier: string; publishedCount: number }
  | { decision: 'rejected'; reason: string }

/**
 * Tell the Vendor the outcome of an admin's KYC decision, including what the
 * approval put live.
 */
export async function notifyVendorKycDecision(
  db: DBOrTx,
  sender: VendorEmailSender,
  vendorUserId: string,
  detail: KycDecisionDetail,
): Promise<void> {
  try {
    const recipient = await loadRecipient(db, vendorUserId)
    if (!recipient) {
      logFailure('kyc-decision', `no email on record for ${vendorUserId}`)
      return
    }

    const result = await sendVendorKycDecisionEmail(
      sender,
      detail.decision === 'approved'
        ? {
            to: recipient.email,
            businessName: recipient.businessName,
            decision: 'approved',
            tier: detail.tier,
            publishedCount: detail.publishedCount,
          }
        : {
            to: recipient.email,
            businessName: recipient.businessName,
            decision: 'rejected',
            reason: detail.reason,
          },
    )
    if (!result.ok) logFailure('kyc-decision', result.error)
  } catch (err: unknown) {
    logFailure('kyc-decision', err instanceof Error ? err.message : String(err))
  }
}
