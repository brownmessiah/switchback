import { and, eq, ne } from 'drizzle-orm'
import { z } from 'zod'

import { vendorProfiles } from '@/db/schema/vendor-profiles'
import type { DBOrTx } from '@/lib/payments/commission-resolver'

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

export type UpdatePayoutMethodResult =
  | { ok: true }
  | { ok: false; error: string }

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

export async function executeUpdatePayoutMethod(
  db: DBOrTx,
  vendorUserId: string,
  input: { payoutMethod: string; payoutDestination: Record<string, unknown> },
): Promise<UpdatePayoutMethodResult> {
  const parsed = updatePayoutMethodSchema.safeParse(input)
  if (!parsed.success) {
    const firstIssue = parsed.error.issues[0]
    return { ok: false, error: firstIssue?.message ?? 'Validation failed.' }
  }

  const { payoutMethod, payoutDestination } = parsed.data

  await db
    .update(vendorProfiles)
    .set({
      payoutMethod,
      payoutDestination,
      payoutDestinationChangedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(vendorProfiles.userId, vendorUserId))

  return { ok: true }
}
