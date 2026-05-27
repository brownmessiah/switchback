'use server'

import { and, eq, sql } from 'drizzle-orm'
import { headers } from 'next/headers'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'

import { db as prodDb } from '@/db/client'
import { siteContent, SITE_SECTIONS, type SiteSection } from '@/db/schema/site-content'
import { auth } from '@/lib/auth'
import { writeAuditLog } from '@/lib/audit/write'
import type { DBOrTx } from '@/lib/payments/commission-resolver'

// ── Result types ────────────────────────────────────────────────────

export type SiteBuilderResult =
  | { ok: true; version?: number }
  | { ok: false; error: string }

// ── Section-specific value schemas ─────────────────────────────────

const heroValueSchema = z.object({
  title: z.string().min(1, 'Hero title is required.'),
  subtitle: z.string().optional(),
  ctaText: z.string().optional(),
  ctaLink: z.string().optional(),
  backgroundImageUrl: z.string().url().nullable().optional(),
})

const announcementBarValueSchema = z.object({
  text: z.string().optional(),
  linkText: z.string().optional(),
  linkUrl: z.string().optional(),
  enabled: z.boolean().optional(),
  backgroundColor: z.string().optional(),
})

const homepageValueSchema = z.object({
  featuredSectionTitle: z.string().optional(),
  featuredExperienceIds: z.array(z.string()).optional(),
  showCategories: z.boolean().optional(),
  showTestimonials: z.boolean().optional(),
})

const brandingValueSchema = z.object({
  logoUrl: z.string().url().nullable().optional(),
  faviconUrl: z.string().url().nullable().optional(),
  primaryColor: z.string().optional(),
  siteName: z.string().optional(),
})

const seoValueSchema = z.object({
  defaultTitle: z.string().optional(),
  titleTemplate: z.string().optional(),
  defaultDescription: z.string().optional(),
  ogImageUrl: z.string().url().nullable().optional(),
  robots: z.string().optional(),
})

const footerValueSchema = z.object({
  companyName: z.string().optional(),
  copyrightText: z.string().optional(),
  links: z
    .array(z.object({ label: z.string(), url: z.string() }))
    .optional(),
  socialLinks: z
    .array(z.object({ platform: z.string(), url: z.string() }))
    .optional(),
})

/** Map section name to its Zod value schema. */
export const SECTION_VALUE_SCHEMAS: Record<SiteSection, z.ZodTypeAny> = {
  hero: heroValueSchema,
  announcement_bar: announcementBarValueSchema,
  homepage: homepageValueSchema,
  branding: brandingValueSchema,
  seo: seoValueSchema,
  footer: footerValueSchema,
}

// ── Input schema ────────────────────────────────────────────────────

const saveSectionSchema = z.object({
  section: z.enum(SITE_SECTIONS, { message: 'Invalid section.' }),
  key: z.string().min(1, 'Key is required.'),
  value: z.record(z.string(), z.unknown()),
  locale: z.string().default('en'),
})

export type SaveSectionInput = z.input<typeof saveSectionSchema>

// ── Core testable: save section ────────────────────────────────────

/**
 * Upsert a site_content row for (section, key, locale).
 * On conflict, bumps the version counter and overwrites value.
 */
export async function executeSaveSection(
  db: DBOrTx,
  adminUserId: string,
  input: SaveSectionInput,
): Promise<SiteBuilderResult> {
  // Validate envelope
  const parsed = saveSectionSchema.safeParse(input)
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Validation failed.' }
  }

  const { section, key, value, locale } = parsed.data

  // Validate section-specific value shape
  const valueSchema = SECTION_VALUE_SCHEMAS[section]
  const valueParsed = valueSchema.safeParse(value)
  if (!valueParsed.success) {
    return { ok: false, error: valueParsed.error.issues[0]?.message ?? 'Invalid value for section.' }
  }

  // Check if row exists
  const [existing] = await db
    .select()
    .from(siteContent)
    .where(
      and(
        eq(siteContent.section, section),
        eq(siteContent.key, key),
        eq(siteContent.locale, locale),
      ),
    )
    .limit(1)

  let newVersion: number

  if (existing) {
    newVersion = existing.version + 1
    await db
      .update(siteContent)
      .set({
        value: valueParsed.data,
        version: newVersion,
        updatedByAdminId: adminUserId,
        updatedAt: sql`now()`,
      })
      .where(eq(siteContent.id, existing.id))
  } else {
    newVersion = 1
    await db.insert(siteContent).values({
      section,
      key,
      value: valueParsed.data,
      locale,
      version: newVersion,
      updatedByAdminId: adminUserId,
    })
  }

  await writeAuditLog(db, {
    actorUserId: adminUserId,
    action: existing ? 'admin.site_content.update' : 'admin.site_content.create',
    entityType: 'site_content',
    entityId: `${section}/${key}/${locale}`,
    payload: { section, key, locale, version: newVersion, value: valueParsed.data },
  })

  return { ok: true, version: newVersion }
}

// ── Core testable: load section ────────────────────────────────────

export interface SiteContentRow {
  readonly id: string
  readonly section: string
  readonly key: string
  readonly value: unknown
  readonly locale: string
  readonly version: number
  readonly updatedByAdminId: string | null
  readonly updatedAt: Date
}

/**
 * Load all content rows for a given section and locale.
 */
export async function executeLoadSection(
  db: DBOrTx,
  section: SiteSection,
  locale: string = 'en',
): Promise<readonly SiteContentRow[]> {
  const rows = await db
    .select()
    .from(siteContent)
    .where(
      and(eq(siteContent.section, section), eq(siteContent.locale, locale)),
    )

  return rows.map((r) => ({
    id: r.id,
    section: r.section,
    key: r.key,
    value: r.value,
    locale: r.locale,
    version: r.version,
    updatedByAdminId: r.updatedByAdminId,
    updatedAt: r.updatedAt,
  }))
}

// ── Server Action wrappers (Next.js boundary) ─────────────────────

export async function saveSection(
  input: SaveSectionInput,
): Promise<SiteBuilderResult> {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) return { ok: false, error: 'Not authenticated.' }

  const result = await executeSaveSection(prodDb, session.user.id, input)

  if (result.ok) {
    revalidatePath('/admin/site-builder')
  }
  return result
}

export async function loadSection(
  section: SiteSection,
  locale: string = 'en',
): Promise<readonly SiteContentRow[]> {
  return executeLoadSection(prodDb, section, locale)
}
