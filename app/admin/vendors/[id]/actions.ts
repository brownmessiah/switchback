'use server'

import { and, eq } from 'drizzle-orm'
import { headers } from 'next/headers'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'

import { db as prodDb } from '@/db/client'
import { experiences } from '@/db/schema/experiences'
import { vendorProfiles } from '@/db/schema/vendor-profiles'
import { auth } from '@/lib/auth'
import { hasAdminPermission } from '@/lib/auth/permissions'
import { writeAuditLog } from '@/lib/audit/write'
import { getEmailSender } from '@/lib/email/resend'
import { adaptEmailSender } from '@/lib/email/vendor-lifecycle'
import { notifyVendorKycDecision } from '@/lib/email/vendor-notifications'
import { assertExperienceWithinTier } from '@/lib/kyc/enforce-tier-caps'
import type { DBOrTx } from '@/lib/payments/commission-resolver'

// ── Result types ────────────────────────────────────────────────────

export type AdminVendorActionResult =
  | { ok: true }
  | { ok: false; error: string }

/**
 * An Experience the KYC-approval cascade declined to publish, with the
 * ADR-0007 tier-cap violation that blocked it. Surfaced to the admin so a
 * partial publish is never silent.
 */
export type CascadePublishSkip = {
  experienceId: string
  code: string
  reason: string
}

/**
 * KYC approval reports what the promotion put live, so the admin sees the
 * consequence of their decision rather than a bare "ok".
 */
export type KycApprovalResult =
  | { ok: true; publishedCount: number; skipped: CascadePublishSkip[] }
  | { ok: false; error: string }

/**
 * Rejection reports how many of the Vendor's Experiences are STILL LIVE.
 * Rejection deliberately does not unpublish them — taking down inventory that
 * may carry Bookings is what the `suspended` flag is for — but the admin must
 * be told, not left to assume the listings came down.
 */
export type KycRejectionResult =
  | { ok: true; requeuedToDraftCount: number; stillLiveCount: number }
  | { ok: false; error: string }

// ── KYC tier promotion ordering ─────────────────────────────────────

/**
 * Valid KYC tier promotions per ADR-0007. Must proceed in strict order:
 * phone → identity → business. Skipping tiers is forbidden.
 */
const VALID_PROMOTIONS: ReadonlyMap<string, string> = new Map([
  ['phone', 'identity'],
  ['identity', 'business'],
])

// ── Validation schemas ─────────────────────────────────────────────

const kycApprovalSchema = z.object({
  vendorUserId: z.string().min(1, 'Vendor user ID is required.'),
  notes: z.string().trim().min(1, 'Notes are required for KYC decisions.').max(2000),
})

const kycRejectionSchema = z.object({
  vendorUserId: z.string().min(1, 'Vendor user ID is required.'),
  reason: z.string().trim().min(1, 'Rejection reason is required.').max(2000),
})

const commissionRateSchema = z.object({
  vendorUserId: z.string().min(1, 'Vendor user ID is required.'),
  commissionRate: z.coerce
    .number()
    .min(0, 'Commission rate cannot be negative.')
    .max(100, 'Commission rate cannot exceed 100%.'),
})

const suspendToggleSchema = z.object({
  vendorUserId: z.string().min(1, 'Vendor user ID is required.'),
  notes: z.string().trim().min(1, 'Notes are required.').max(2000),
})

// ── Core testable functions ─────────────────────────────────────────

/**
 * Promote a Vendor one KYC tier, then put the Experiences that promotion
 * unlocks live (ADR-0007).
 *
 * The cascade is the reconciliation of the product requirement "on accept,
 * the Vendor's listings go live" with ADR-0007's two-gate design. It does NOT
 * bypass the publish-time tier caps — it re-runs the SAME guard the admin
 * Experience queue runs (`assertExperienceWithinTier`) against the Vendor's
 * newly-raised tier, and publishes only what passes:
 *
 *   - Only `pending_review` Experiences are considered. Drafts are excluded
 *     by design: ADR-0007 Tier 1 explicitly permits drafting, and a draft is
 *     half-finished by definition — publishing one would put unreviewed
 *     content on the public site.
 *   - An over-cap Experience is SKIPPED, not failed. It stays `pending_review`
 *     and is reported back, so one bad listing never blocks the promotion.
 *
 * Ordering is load-bearing: the tier UPDATE must be visible to the cap check,
 * or every listing trips PHONE_CANNOT_PUBLISH and nothing publishes.
 *
 * Not wrapped in an explicit transaction, matching the rest of this module.
 * Each publish writes its own audit row, so a mid-cascade failure leaves a
 * visible, recoverable state: the tier is raised and any still-queued
 * Experience remains actionable in the admin Experience queue.
 */
export async function executeKycApproval(
  db: DBOrTx,
  adminUserId: string,
  input: { vendorUserId: string; notes: string },
): Promise<KycApprovalResult> {
  const parsed = kycApprovalSchema.safeParse(input)
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Validation failed.' }
  }

  const { vendorUserId, notes } = parsed.data

  // Fetch current vendor KYC tier
  const [vendor] = await db
    .select({ kycTier: vendorProfiles.kycTier })
    .from(vendorProfiles)
    .where(eq(vendorProfiles.userId, vendorUserId))
    .limit(1)

  if (!vendor) {
    return { ok: false, error: 'Vendor not found.' }
  }

  const nextTier = VALID_PROMOTIONS.get(vendor.kycTier)
  if (!nextTier) {
    return { ok: false, error: `Vendor is already at the highest KYC tier (${vendor.kycTier}).` }
  }

  // Promote the tier AND record the decision. Approving is what lets this
  // Vendor's listings go live at all; the tier only decides which of them the
  // ADR-0007 caps permit. A previously-rejected Vendor being approved here is
  // the documented re-apply path, so the stale rejection reason is cleared.
  await db
    .update(vendorProfiles)
    .set({
      kycTier: nextTier as 'identity' | 'business',
      applicationStatus: 'approved',
      applicationDecisionReason: null,
      applicationDecidedAt: new Date(),
      applicationDecidedBy: adminUserId,
      updatedAt: new Date(),
    })
    .where(eq(vendorProfiles.userId, vendorUserId))

  await writeAuditLog(db, {
    actorUserId: adminUserId,
    action: 'admin.kyc.approve',
    entityType: 'vendor_profile',
    entityId: vendorUserId,
    payload: {
      previousTier: vendor.kycTier,
      newTier: nextTier,
      notes,
    },
  })

  const { publishedCount, skipped } = await cascadePublishQueuedExperiences(
    db,
    adminUserId,
    vendorUserId,
  )

  return { ok: true, publishedCount, skipped }
}

/**
 * Publish every `pending_review` Experience of one Vendor that passes the
 * ADR-0007 tier caps at the Vendor's CURRENT tier. Callers must have already
 * committed the tier change. Returns what went live and what was held back.
 */
async function cascadePublishQueuedExperiences(
  db: DBOrTx,
  adminUserId: string,
  vendorUserId: string,
): Promise<{ publishedCount: number; skipped: CascadePublishSkip[] }> {
  const queued = await db
    .select({ id: experiences.id })
    .from(experiences)
    .where(
      and(
        eq(experiences.vendorUserId, vendorUserId),
        eq(experiences.status, 'pending_review'),
      ),
    )

  const skipped: CascadePublishSkip[] = []
  let publishedCount = 0

  for (const queuedExperience of queued) {
    const tierCheck = await assertExperienceWithinTier(db, queuedExperience.id)

    if (!tierCheck.ok) {
      skipped.push({
        experienceId: queuedExperience.id,
        code: tierCheck.code,
        reason: tierCheck.reason,
      })
      await writeAuditLog(db, {
        actorUserId: adminUserId,
        action: 'admin.experience.tier_cap_rejected',
        entityType: 'experience',
        entityId: queuedExperience.id,
        payload: {
          code: tierCheck.code,
          reason: tierCheck.reason,
          viaKycApproval: true,
        },
      })
      continue
    }

    await db
      .update(experiences)
      .set({ status: 'published', updatedAt: new Date() })
      .where(eq(experiences.id, queuedExperience.id))

    await writeAuditLog(db, {
      actorUserId: adminUserId,
      action: 'admin.experience.approve',
      entityType: 'experience',
      entityId: queuedExperience.id,
      payload: {
        previousStatus: 'pending_review',
        newStatus: 'published',
        viaKycApproval: true,
      },
    })

    publishedCount += 1
  }

  return { publishedCount, skipped }
}

/**
 * Reject a Vendor's application.
 *
 * Rejection is a DECISION, not a downgrade: the KYC tier is left alone,
 * because the tier records what was verified and rejection does not un-verify
 * it. What rejection changes is whether anything may go live.
 *
 * Consequences, in order of how surprising they would be if wrong:
 *   - `application_status` becomes 'rejected' with the admin's reason, which
 *     the Vendor is shown so they can fix it and re-apply.
 *   - Queued (`pending_review`) Experiences return to `draft`. Leaving them in
 *     a review queue that can never resolve would be a lie to both sides.
 *   - Already-`published` Experiences are LEFT ALONE and counted back to the
 *     caller. Unpublishing live inventory that may carry Bookings is what the
 *     `suspended` flag exists for; doing it silently here would be a large,
 *     unasked-for hammer. The count exists so the admin is told, not so the
 *     system can stay quiet about it.
 */
export async function executeKycRejection(
  db: DBOrTx,
  adminUserId: string,
  input: { vendorUserId: string; reason: string },
): Promise<KycRejectionResult> {
  const parsed = kycRejectionSchema.safeParse(input)
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Validation failed.' }
  }

  const { vendorUserId, reason } = parsed.data

  // Verify vendor exists
  const [vendor] = await db
    .select({ kycTier: vendorProfiles.kycTier })
    .from(vendorProfiles)
    .where(eq(vendorProfiles.userId, vendorUserId))
    .limit(1)

  if (!vendor) {
    return { ok: false, error: 'Vendor not found.' }
  }

  await db
    .update(vendorProfiles)
    .set({
      applicationStatus: 'rejected',
      applicationDecisionReason: reason,
      applicationDecidedAt: new Date(),
      applicationDecidedBy: adminUserId,
      updatedAt: new Date(),
    })
    .where(eq(vendorProfiles.userId, vendorUserId))

  // Nothing queued can proceed — return it to the Vendor as a draft.
  const requeued = await db
    .update(experiences)
    .set({ status: 'draft', updatedAt: new Date() })
    .where(
      and(
        eq(experiences.vendorUserId, vendorUserId),
        eq(experiences.status, 'pending_review'),
      ),
    )
    .returning({ id: experiences.id })

  const stillLive = await db
    .select({ id: experiences.id })
    .from(experiences)
    .where(
      and(
        eq(experiences.vendorUserId, vendorUserId),
        eq(experiences.status, 'published'),
      ),
    )

  await writeAuditLog(db, {
    actorUserId: adminUserId,
    action: 'admin.kyc.reject',
    entityType: 'vendor_profile',
    entityId: vendorUserId,
    payload: {
      currentTier: vendor.kycTier,
      reason,
      requeuedToDraftCount: requeued.length,
      stillLiveCount: stillLive.length,
    },
  })

  return {
    ok: true,
    requeuedToDraftCount: requeued.length,
    stillLiveCount: stillLive.length,
  }
}

export async function executeCommissionRateUpdate(
  db: DBOrTx,
  adminUserId: string,
  input: { vendorUserId: string; commissionRate: number },
): Promise<AdminVendorActionResult> {
  const parsed = commissionRateSchema.safeParse(input)
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Validation failed.' }
  }

  const { vendorUserId, commissionRate } = parsed.data

  // Fetch current rate for the audit log
  const [vendor] = await db
    .select({ commissionRate: vendorProfiles.commissionRate })
    .from(vendorProfiles)
    .where(eq(vendorProfiles.userId, vendorUserId))
    .limit(1)

  if (!vendor) {
    return { ok: false, error: 'Vendor not found.' }
  }

  const newRate = commissionRate.toFixed(2)

  await db
    .update(vendorProfiles)
    .set({
      commissionRate: newRate,
      updatedAt: new Date(),
    })
    .where(eq(vendorProfiles.userId, vendorUserId))

  await writeAuditLog(db, {
    actorUserId: adminUserId,
    action: 'admin.commission_rate.update',
    entityType: 'vendor_profile',
    entityId: vendorUserId,
    payload: {
      previousRate: vendor.commissionRate,
      newRate,
    },
  })

  return { ok: true }
}

export async function executeSuspendToggle(
  db: DBOrTx,
  adminUserId: string,
  input: { vendorUserId: string; notes: string },
): Promise<AdminVendorActionResult> {
  const parsed = suspendToggleSchema.safeParse(input)
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Validation failed.' }
  }

  const { vendorUserId, notes } = parsed.data

  const [vendor] = await db
    .select({ suspended: vendorProfiles.suspended })
    .from(vendorProfiles)
    .where(eq(vendorProfiles.userId, vendorUserId))
    .limit(1)

  if (!vendor) {
    return { ok: false, error: 'Vendor not found.' }
  }

  const newSuspendedState = !vendor.suspended

  await db
    .update(vendorProfiles)
    .set({
      suspended: newSuspendedState,
      updatedAt: new Date(),
    })
    .where(eq(vendorProfiles.userId, vendorUserId))

  await writeAuditLog(db, {
    actorUserId: adminUserId,
    action: newSuspendedState ? 'admin.vendor.suspend' : 'admin.vendor.reactivate',
    entityType: 'vendor_profile',
    entityId: vendorUserId,
    payload: {
      suspended: newSuspendedState,
      notes,
    },
  })

  return { ok: true }
}

// ── Server action wrappers (auth layer) ─────────────────────────────

export async function approveKycAction(
  formData: FormData,
): Promise<KycApprovalResult> {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) return { ok: false, error: 'Not authenticated.' }
  if (!(await hasAdminPermission(prodDb, session.user.id, 'vendors'))) {
    return { ok: false, error: 'You do not have permission to manage vendors.' }
  }

  const vendorUserId = formData.get('vendorUserId') as string
  const notes = formData.get('notes') as string

  const result = await executeKycApproval(prodDb, session.user.id, {
    vendorUserId,
    notes,
  })

  if (result.ok) {
    // Tell the Vendor they are approved and what it put live. Best-effort —
    // the promotion has already committed.
    const [vendorTier] = await prodDb
      .select({ kycTier: vendorProfiles.kycTier })
      .from(vendorProfiles)
      .where(eq(vendorProfiles.userId, vendorUserId))
      .limit(1)

    await notifyVendorKycDecision(prodDb, adaptEmailSender(getEmailSender()), vendorUserId, {
      decision: 'approved',
      tier: vendorTier?.kycTier ?? 'identity',
      publishedCount: result.publishedCount,
    })

    revalidatePath(`/admin/vendors/${vendorUserId}`)
    // The cascade may have put listings live on the public site.
    if (result.publishedCount > 0) revalidatePath('/admin/experiences')
  }
  return result
}

export async function rejectKycAction(
  formData: FormData,
): Promise<AdminVendorActionResult> {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) return { ok: false, error: 'Not authenticated.' }
  if (!(await hasAdminPermission(prodDb, session.user.id, 'vendors'))) {
    return { ok: false, error: 'You do not have permission to manage vendors.' }
  }

  const vendorUserId = formData.get('vendorUserId') as string
  const reason = formData.get('reason') as string

  const result = await executeKycRejection(prodDb, session.user.id, {
    vendorUserId,
    reason,
  })

  if (result.ok) {
    // A rejected Vendor is otherwise never told — the decision only landed in
    // the audit log, which they cannot see.
    await notifyVendorKycDecision(prodDb, adaptEmailSender(getEmailSender()), vendorUserId, {
      decision: 'rejected',
      reason,
    })
    revalidatePath(`/admin/vendors/${vendorUserId}`)
  }
  return result
}

export async function updateCommissionRateAction(
  formData: FormData,
): Promise<AdminVendorActionResult> {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) return { ok: false, error: 'Not authenticated.' }
  if (!(await hasAdminPermission(prodDb, session.user.id, 'vendors'))) {
    return { ok: false, error: 'You do not have permission to manage vendors.' }
  }

  const vendorUserId = formData.get('vendorUserId') as string
  const commissionRate = Number(formData.get('commissionRate'))

  const result = await executeCommissionRateUpdate(prodDb, session.user.id, {
    vendorUserId,
    commissionRate,
  })

  if (result.ok) revalidatePath(`/admin/vendors/${vendorUserId}`)
  return result
}

export async function toggleSuspendAction(
  formData: FormData,
): Promise<AdminVendorActionResult> {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) return { ok: false, error: 'Not authenticated.' }
  if (!(await hasAdminPermission(prodDb, session.user.id, 'vendors'))) {
    return { ok: false, error: 'You do not have permission to manage vendors.' }
  }

  const vendorUserId = formData.get('vendorUserId') as string
  const notes = formData.get('notes') as string

  const result = await executeSuspendToggle(prodDb, session.user.id, {
    vendorUserId,
    notes,
  })

  if (result.ok) revalidatePath(`/admin/vendors/${vendorUserId}`)
  return result
}
