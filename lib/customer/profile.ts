import { eq } from 'drizzle-orm'
import { z } from 'zod'

import { customerProfiles } from '@/db/schema/customer-profiles'
import { users } from '@/db/schema/users'
import type { DBOrTx } from '@/lib/payments/commission-resolver'

/**
 * Customer profile editor — the pure, testable core behind the `/settings`
 * Server Action. It writes ACROSS two tables (`users` + `customer_profiles`)
 * in a single transaction so the display identity and the customer-role
 * fields can never half-commit.
 *
 * No migration: every column written here already exists (ADR-0006 /
 * ADR-0015). The `customer_profiles` row is upserted because a freshly
 * registered User may not have one yet.
 */

// ── Validation ──────────────────────────────────────────────────────

const addressSchema = z.object({
  line1: z
    .string()
    .transform((s) => s.trim())
    .pipe(z.string().min(1, 'Address line is required.').max(200, 'Address line is too long.')),
  city: z
    .string()
    .transform((s) => s.trim())
    .pipe(z.string().min(1, 'City is required.').max(100, 'City is too long.')),
  state: z
    .string()
    .transform((s) => s.trim())
    .pipe(z.string().min(1, 'State is required.').max(100, 'State is too long.')),
  pincode: z
    .string()
    .transform((s) => s.trim())
    .pipe(z.string().regex(/^\d{6}$/, 'Pincode must be 6 digits.')),
})

export type CustomerAddress = z.infer<typeof addressSchema>

const optionalTrimmed = (max: number, label: string) =>
  z
    .string()
    .transform((s) => s.trim())
    .pipe(z.string().max(max, `${label} is too long.`))
    .transform((s) => (s === '' ? null : s))
    .nullable()

const updateCustomerProfileSchema = z.object({
  displayName: z
    .string()
    .transform((s) => s.trim())
    .pipe(z.string().min(1, 'Display name is required.').max(120, 'Display name is too long.')),
  avatarUrl: z
    .string()
    .transform((s) => s.trim())
    .pipe(z.union([z.literal(''), z.string().url('Avatar URL must be a valid URL.')]))
    .transform((s) => (s === '' ? null : s))
    .nullable(),
  address: addressSchema.nullable(),
  trustedContactName: optionalTrimmed(120, 'Trusted contact name'),
  trustedContactPhone: optionalTrimmed(20, 'Trusted contact phone'),
  trustedContactRelationship: optionalTrimmed(60, 'Trusted contact relationship'),
})

export type UpdateCustomerProfileInput = z.input<typeof updateCustomerProfileSchema>

export type UpdateCustomerProfileResult =
  | { ok: true }
  | { ok: false; error: string }

// ── Core ────────────────────────────────────────────────────────────

/**
 * Validate `input` and persist it across `users` + `customer_profiles` in
 * one transaction. Exported for direct testing with a PGlite handle —
 * the Server Action wrapper supplies the production db and the auth'd
 * userId.
 */
export async function updateCustomerProfile(
  db: DBOrTx,
  userId: string,
  input: UpdateCustomerProfileInput,
): Promise<UpdateCustomerProfileResult> {
  const parsed = updateCustomerProfileSchema.safeParse(input)
  if (!parsed.success) {
    const firstIssue = parsed.error.issues[0]
    return { ok: false, error: firstIssue?.message ?? 'Validation failed.' }
  }

  const {
    displayName,
    avatarUrl,
    address,
    trustedContactName,
    trustedContactPhone,
    trustedContactRelationship,
  } = parsed.data

  await db.transaction(async (tx) => {
    await tx
      .update(users)
      .set({ name: displayName, image: avatarUrl, updatedAt: new Date() })
      .where(eq(users.id, userId))

    await tx
      .insert(customerProfiles)
      .values({
        userId,
        defaultAddress: address,
        trustedContactName,
        trustedContactPhone,
        trustedContactRelationship,
      })
      .onConflictDoUpdate({
        target: customerProfiles.userId,
        set: {
          defaultAddress: address,
          trustedContactName,
          trustedContactPhone,
          trustedContactRelationship,
          updatedAt: new Date(),
        },
      })
  })

  return { ok: true }
}
