'use server'

import { headers } from 'next/headers'

import { db } from '@/db/client'
import { vendorProfiles } from '@/db/schema'
import { auth } from '@/lib/auth'

interface CreateVendorProfileInput {
  businessName: string
  slug: string
  pan?: string
  about?: string
}

type CreateVendorProfileResult =
  | { ok: true }
  | { ok: false; error: string }

export async function createVendorProfileAction(
  input: CreateVendorProfileInput,
): Promise<CreateVendorProfileResult> {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) {
    return { ok: false, error: 'Sign in to continue.' }
  }

  if (!input.businessName || !input.slug) {
    return { ok: false, error: 'Business name and slug are required.' }
  }

  if (!/^[a-z0-9-]+$/.test(input.slug)) {
    return { ok: false, error: 'Slug can only contain lowercase letters, numbers, and hyphens.' }
  }

  try {
    await db.insert(vendorProfiles).values({
      userId: session.user.id,
      businessName: input.businessName,
      slug: input.slug,
      pan: input.pan || null,
      kycTier: input.pan ? 'identity' : 'phone',
    })

    return { ok: true }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    if (message.includes('unique') || message.includes('duplicate')) {
      return { ok: false, error: 'This slug is already taken. Please choose another.' }
    }
    return { ok: false, error: 'Failed to create profile. Please try again.' }
  }
}
