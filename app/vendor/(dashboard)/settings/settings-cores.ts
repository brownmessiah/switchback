import { and, eq, ne } from 'drizzle-orm'
import { z } from 'zod'

import { vendorFundAccounts } from '@/db/schema/vendor-fund-accounts'
import { vendorProfiles } from '@/db/schema/vendor-profiles'
import type { DBOrTx } from '@/lib/payments/commission-resolver'
import { destinationFingerprint } from '@/lib/payments/payout-destination'
import {
  createContact as realCreateContact,
  createFundAccount as realCreateFundAccount,
} from '@/lib/payments/razorpayx-client'
import type {
  CreateContactInput,
  CreateContactResult,
  CreateFundAccountInput,
  CreateFundAccountResult,
} from '@/lib/payments/razorpayx-client'

/**
 * Vendor settings CORES (issue #03 security split).
 *
 * db-injected, auth-free, integration-testable. Deliberately NOT in the
 * `'use server'` module: exporting a core that takes an arbitrary
 * `vendorUserId` from a `'use server'` file would be a client-callable IDOR
 * hole on the business-details / bank-details path. The thin Server Action
 * wrapper in ./actions derives identity from the session and gates with
 * `hasVendorAccess` (kyc:manage for business details, bank:manage for payout
 * method) before delegating here.
 */

// ── Result types ────────────────────────────────────────────────────

export type UpdateBusinessDetailsResult =
  | { ok: true }
  | { ok: false; error: string }

/**
 * On a validation rejection the destination is NOT written (`destinationSaved`
 * absent/false). On a provisioning failure the destination IS written first —
 * `destinationSaved: true` tells the caller the Vendor's choice is durable and
 * the error is a retriable Razorpay X failure, not a rejection of their input.
 */
export type UpdatePayoutMethodResult =
  | { ok: true }
  | { ok: false; error: string; destinationSaved?: boolean }

/**
 * Injectable Razorpay X provisioning deps. Tests pass a stub so they never hit
 * the network; production defaults to the slice-02 client functions.
 */
export interface PayoutProvisioningDeps {
  createContact: (input: CreateContactInput) => Promise<CreateContactResult>
  createFundAccount: (input: CreateFundAccountInput) => Promise<CreateFundAccountResult>
}

const defaultProvisioningDeps: PayoutProvisioningDeps = {
  createContact: realCreateContact,
  createFundAccount: realCreateFundAccount,
}

/** 7-day cooling-off on destination change (ADR-0016 anti-account-takeover). */
const COOLING_OFF_MS = 7 * 24 * 60 * 60 * 1000

function provisioningErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Payout provisioning failed.'
}

// ── Validation schemas ─────────────────────────────────────────────

const slugRegex = /^[a-z0-9-]+$/

const updateBusinessDetailsSchema = z.object({
  businessName: z
    .string()
    .transform((s) => s.trim())
    .pipe(z.string().min(1, 'Business name is required.').max(200, 'Business name is too long.')),
  slug: z
    .string()
    .transform((s) => s.trim().toLowerCase())
    .pipe(
      z
        .string()
        .min(1, 'Slug is required.')
        .max(100, 'Slug is too long.')
        .regex(slugRegex, 'Slug can only contain lowercase letters, numbers, and hyphens.'),
    ),
  about: z
    .string()
    .max(2000, 'About must be under 2000 characters.')
    .nullable(),
})

export type UpdateBusinessDetailsInput = z.infer<typeof updateBusinessDetailsSchema>

const upiDestinationSchema = z.object({
  vpa: z.string().min(1, 'UPI VPA is required.'),
})

const bankAccountDestinationSchema = z.object({
  accountNumber: z.string().min(1, 'Account number is required.'),
  ifsc: z.string().min(1, 'IFSC code is required.'),
  accountHolderName: z.string().min(1, 'Account holder name is required.'),
})

const updatePayoutMethodSchema = z.discriminatedUnion('payoutMethod', [
  z.object({
    payoutMethod: z.literal('upi'),
    payoutDestination: upiDestinationSchema,
  }),
  z.object({
    payoutMethod: z.literal('bank_account'),
    payoutDestination: bankAccountDestinationSchema,
  }),
])

export type UpdatePayoutMethodInput = z.infer<typeof updatePayoutMethodSchema>

// ── Cores ────────────────────────────────────────────────────────────

export async function executeUpdateBusinessDetails(
  db: DBOrTx,
  vendorUserId: string,
  input: { businessName: string; slug: string; about: string | null },
): Promise<UpdateBusinessDetailsResult> {
  const parsed = updateBusinessDetailsSchema.safeParse(input)
  if (!parsed.success) {
    const firstIssue = parsed.error.issues[0]
    return { ok: false, error: firstIssue?.message ?? 'Validation failed.' }
  }

  const { businessName, slug, about } = parsed.data

  // Check slug uniqueness — exclude the current vendor's own slug.
  const [conflict] = await db
    .select({ userId: vendorProfiles.userId })
    .from(vendorProfiles)
    .where(
      and(
        eq(vendorProfiles.slug, slug),
        ne(vendorProfiles.userId, vendorUserId),
      ),
    )
    .limit(1)

  if (conflict) {
    return { ok: false, error: 'This slug is already taken. Please choose another.' }
  }

  await db
    .update(vendorProfiles)
    .set({
      businessName,
      slug,
      about,
      updatedAt: new Date(),
    })
    .where(eq(vendorProfiles.userId, vendorUserId))

  return { ok: true }
}

/**
 * Set/change a Vendor's payout destination and EAGERLY provision the Razorpay X
 * entities so the account is ready by the time the 7-day cooling-off elapses
 * (ADR-0016, 2026-06-18 amendment).
 *
 * Order matters for recoverability:
 *  1. Validate. On failure nothing is written.
 *  2. Persist the destination FIRST — the Vendor's choice is durable regardless
 *     of provisioning outcome.
 *  3. Provision: one Contact per Vendor (cached on razorpay_contact_id, reused
 *     on later changes), one Fund Account per distinct destination fingerprint
 *     (retained as history; change-back reuses the row, cooling-off untouched).
 *
 * A Razorpay X failure leaves the destination saved and surfaces a retriable
 * error (`{ ok: false, destinationSaved: true }`) — never a half-applied state:
 * a contact id is only cached after the call returns it, and a fund-account row
 * is only inserted with a real fund-account id. The unique index guards
 * concurrent retries via onConflictDoNothing.
 */
export async function executeUpdatePayoutMethod(
  db: DBOrTx,
  vendorUserId: string,
  input: { payoutMethod: string; payoutDestination: Record<string, unknown> },
  deps: PayoutProvisioningDeps = defaultProvisioningDeps,
): Promise<UpdatePayoutMethodResult> {
  const parsed = updatePayoutMethodSchema.safeParse(input)
  if (!parsed.success) {
    const firstIssue = parsed.error.issues[0]
    return { ok: false, error: firstIssue?.message ?? 'Validation failed.' }
  }

  const { payoutMethod, payoutDestination } = parsed.data

  // Step 2 — persist the destination first; capture the change time so the
  // cooling-off stamp matches it exactly.
  const changedAt = new Date()
  await db
    .update(vendorProfiles)
    .set({
      payoutMethod,
      payoutDestination,
      payoutDestinationChangedAt: changedAt,
      updatedAt: changedAt,
    })
    .where(eq(vendorProfiles.userId, vendorUserId))

  // Step 3 — eager provisioning. Any throw here surfaces a retriable error
  // while the destination above stays saved.
  try {
    await provisionPayoutDestination(db, vendorUserId, {
      payoutMethod,
      payoutDestination,
      changedAt,
      deps,
    })
  } catch (error: unknown) {
    return {
      ok: false,
      error: provisioningErrorMessage(error),
      destinationSaved: true,
    }
  }

  return { ok: true }
}

interface ProvisionArgs {
  payoutMethod: 'upi' | 'bank_account'
  payoutDestination: Record<string, unknown>
  changedAt: Date
  deps: PayoutProvisioningDeps
}

/**
 * Provision the Razorpay X Contact (once per Vendor) and Fund Account (once per
 * distinct destination). Reads the Vendor row for the cached contact id and
 * business name; writes back the contact id only after a successful create.
 */
async function provisionPayoutDestination(
  db: DBOrTx,
  vendorUserId: string,
  args: ProvisionArgs,
): Promise<void> {
  const { payoutMethod, payoutDestination, changedAt, deps } = args

  const [vendor] = await db
    .select({
      businessName: vendorProfiles.businessName,
      razorpayContactId: vendorProfiles.razorpayContactId,
    })
    .from(vendorProfiles)
    .where(eq(vendorProfiles.userId, vendorUserId))

  if (!vendor) {
    throw new Error('Vendor profile not found for payout provisioning.')
  }

  // Contact — once per Vendor; reuse the cached id, otherwise create + cache it.
  let contactId = vendor.razorpayContactId
  if (!contactId) {
    const contact = await deps.createContact({
      name: vendor.businessName,
      referenceId: vendorUserId,
      type: 'vendor',
    })
    contactId = contact.contactId
    await db
      .update(vendorProfiles)
      .set({ razorpayContactId: contactId, updatedAt: new Date() })
      .where(eq(vendorProfiles.userId, vendorUserId))
  }

  // Fund Account — once per distinct destination fingerprint. A change-back to
  // a prior destination reuses the retained row (history); cooling-off is left
  // untouched because that destination was already validated.
  const fingerprint = destinationFingerprint(payoutDestination)
  const [existing] = await db
    .select({ id: vendorFundAccounts.id })
    .from(vendorFundAccounts)
    .where(
      and(
        eq(vendorFundAccounts.vendorUserId, vendorUserId),
        eq(vendorFundAccounts.destinationFingerprint, fingerprint),
      ),
    )
    .limit(1)
  if (existing) {
    return
  }

  const fundAccount = await deps.createFundAccount(
    toFundAccountInput(contactId, payoutMethod, payoutDestination),
  )

  await db
    .insert(vendorFundAccounts)
    .values({
      vendorUserId,
      destinationFingerprint: fingerprint,
      razorpayFundAccountId: fundAccount.fundAccountId,
      coolingOffUntil: new Date(changedAt.getTime() + COOLING_OFF_MS),
    })
    // Defensive against a concurrent retry winning the race on the unique index.
    .onConflictDoNothing({
      target: [vendorFundAccounts.vendorUserId, vendorFundAccounts.destinationFingerprint],
    })
}

/** Map the validated payout destination to the slice-02 client's arg shape. */
function toFundAccountInput(
  contactId: string,
  payoutMethod: 'upi' | 'bank_account',
  payoutDestination: Record<string, unknown>,
): CreateFundAccountInput {
  if (payoutMethod === 'upi') {
    return {
      contactId,
      accountType: 'vpa',
      vpa: { address: payoutDestination['vpa'] as string },
    }
  }
  return {
    contactId,
    accountType: 'bank_account',
    bankAccount: {
      name: payoutDestination['accountHolderName'] as string,
      ifsc: payoutDestination['ifsc'] as string,
      accountNumber: payoutDestination['accountNumber'] as string,
    },
  }
}
