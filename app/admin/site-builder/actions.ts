'use server'

import { and, eq, sql } from 'drizzle-orm'
import { headers } from 'next/headers'
import { revalidatePath } from 'next/cache'

import { db as prodDb } from '@/db/client'
import { siteContent, type SiteSection } from '@/db/schema/site-content'
import { auth } from '@/lib/auth'
import { hasAdminPermission } from '@/lib/auth/permissions'
import { writeAuditLog } from '@/lib/audit/write'
import type { DBOrTx } from '@/lib/payments/commission-resolver'

import {
  SECTION_VALUE_SCHEMAS,
  saveSectionSchema,
  type SaveSectionInput,
  type SiteBuilderResult,
  type SiteContentRow,
} from './schema'

// NOTE: this `'use server'` module deliberately exports ONLY async Server
// Functions. We do NOT re-export the value types from here — Next's
// server-actions loader rewrites even `export type { … }` re-exports into a
// runtime `export { … }`, which throws `ReferenceError: <Type> is not defined`
// at module-eval and 500s every action. Consumers import these types straight
// from `./schema` instead.

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
  if (!(await hasAdminPermission(prodDb, session.user.id, 'site_builder'))) {
    return { ok: false, error: 'You do not have permission to edit site content.' }
  }

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
