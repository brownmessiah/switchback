'use server'

import { and, eq, ne } from 'drizzle-orm'
import { headers } from 'next/headers'
import { z } from 'zod'

import { db as prodDb } from '@/db/client'
import { vendorProfiles } from '@/db/schema/vendor-profiles'
import { auth } from '@/lib/auth'
import type { DBOrTx } from '@/lib/payments/commission-resolver'

// ── Result types ────────────────────────────────────────────────────

export type CreateVendorProfileResult =
  | { ok: true }
  | { ok: false; error: string }

// ── Validation schema ───────────────────────────────────────────────

const slugRegex = /^[a-z0-9-]+$/
// PAN: 5 letters, 4 digits, 1 letter (e.g. ABCDE1234F).
const panRegex = /^[A-Z]{5}[0-9]{4}[A-Z]$/

const createVendorProfileSchema = z.object({
  businessName: z
    .string()
    .transform((s) => s.trim())
    .pipe(
      z
        .string()
        .min(1, 'Business name is required.')
        .max(200, 'Business name is too long.'),
    ),
  slug: z
    .string()
    .transform((s) => s.trim().toLowerCase())
    .pipe(
      z
        .string()
        .min(1, 'Profile URL (slug) is required.')
        .max(100, 'Profile URL (slug) is too long.')
        .regex(
          slugRegex,
          'Profile URL (slug) can only contain lowercase letters, numbers, and hyphens.',
        ),
    ),
  // PAN is optional at onboarding. When supplied it is captured as evidence
  // for the later admin KYC review, but it does NOT change the KYC tier.
  pan: z
    .string()
    .transform((s) => s.trim().toUpperCase())
    .pipe(z.string().regex(panRegex, 'PAN must be in the format ABCDE1234F.'))
    .nullable()
    .optional(),
  about: z
    .string()
    .max(2000, 'About must be under 2000 characters.')
    .nullable()
    .optional(),
})

export type CreateVendorProfileInput = z.input<typeof createVendorProfileSchema>

// ── Core testable function ──────────────────────────────────────────

/**
 * Creates a Vendor profile for the given user.
 *
 * Per ADR-0007, a freshly-onboarded Vendor is ALWAYS at the `phone`
 * KYC tier — they completed MSG91 OTP at signup but have done no identity
 * verification yet. Reaching the `identity` tier requires Aadhaar OTP
 * (or the interim PAN + selfie + ID upload path) PLUS admin manual
 * review, which is owned by the admin KYC-approval flow (executeKycApproval).
 *
 * A PAN may be captured here as evidence for that later review, but it
 * MUST NOT self-promote the tier — doing so would bypass the manual
 * review mandated by ADR-0007.
 */
export async function executeCreateVendorProfile(
  db: DBOrTx,
  userId: string,
  input: CreateVendorProfileInput,
): Promise<CreateVendorProfileResult> {
  const parsed = createVendorProfileSchema.safeParse(input)
  if (!parsed.success) {
    const firstIssue = parsed.error.issues[0]
    return { ok: false, error: firstIssue?.message ?? 'Validation failed.' }
  }

  const { businessName, slug, pan, about } = parsed.data

  // Look up this user's existing profile, if any.
  const [existing] = await db
    .select({ userId: vendorProfiles.userId, closedAt: vendorProfiles.closedAt })
    .from(vendorProfiles)
    .where(eq(vendorProfiles.userId, userId))
    .limit(1)

  // An ACTIVE profile already exists — reject (one Vendor profile per user).
  if (existing && !existing.closedAt) {
    return { ok: false, error: 'You already have a vendor profile.' }
  }

  // Reject duplicate slugs taken by another vendor.
  const [conflict] = await db
    .select({ userId: vendorProfiles.userId })
    .from(vendorProfiles)
    .where(and(eq(vendorProfiles.slug, slug), ne(vendorProfiles.userId, userId)))
    .limit(1)

  if (conflict) {
    return { ok: false, error: 'This slug is already taken. Please choose another.' }
  }

  // Reactivation path (issue 06): a soft-closed Vendor re-onboarding. Clear
  // closed_at + reason and refresh business details on the SAME row instead of
  // inserting (which would violate the userId PK). Honors the reversible-close
  // decision — slug retained, history never deleted.
  if (existing?.closedAt) {
    await db
      .update(vendorProfiles)
      .set({
        businessName,
        slug,
        pan: pan ?? null,
        about: about ?? null,
        closedAt: null,
        closureReason: null,
        updatedAt: new Date(),
      })
      .where(eq(vendorProfiles.userId, userId))

    return { ok: true }
  }

  try {
    await db.insert(vendorProfiles).values({
      userId,
      businessName,
      slug,
      pan: pan ?? null,
      about: about ?? null,
      // ADR-0007: always phone tier on creation. The identity tier is
      // granted only by admin manual review (executeKycApproval).
      kycTier: 'phone',
    })

    return { ok: true }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    // Defence in depth against the unique(slug) constraint racing the
    // pre-check above.
    if (message.includes('unique') || message.includes('duplicate')) {
      return { ok: false, error: 'This slug is already taken. Please choose another.' }
    }
    return { ok: false, error: 'Failed to create profile. Please try again.' }
  }
}

// ── Server action wrapper (auth layer) ──────────────────────────────

export async function createVendorProfileAction(
  input: CreateVendorProfileInput,
): Promise<CreateVendorProfileResult> {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) {
    return { ok: false, error: 'Sign in to continue.' }
  }

  return executeCreateVendorProfile(prodDb, session.user.id, input)
}
