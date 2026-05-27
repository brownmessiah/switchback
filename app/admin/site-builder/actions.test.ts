import { sql } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { auditLogs } from '@/db/schema/audit-logs'
import { siteContent } from '@/db/schema/site-content'
import { users } from '@/db/schema/users'
import { setupTestDb, type TestDB } from '@/tests/helpers/db'

import {
  executeSaveSection,
  executeLoadSection,
  SECTION_VALUE_SCHEMAS,
} from './actions'

// ── Test helpers ────────────────────────────────────────────────────

async function seedAdmin(db: TestDB): Promise<string> {
  const adminId = 'admin_site_1'
  await db.insert(users).values({ id: adminId, email: 'admin-site@test.com' })
  return adminId
}

// ── Tests ───────────────────────────────────────────────────────────

describe('Site builder section value schemas', () => {
  it('exports a schema for every section', () => {
    const sections = ['hero', 'announcement_bar', 'homepage', 'branding', 'seo', 'footer'] as const
    for (const section of sections) {
      expect(SECTION_VALUE_SCHEMAS[section]).toBeDefined()
    }
  })

  it('hero schema requires title', () => {
    const result = SECTION_VALUE_SCHEMAS.hero.safeParse({})
    expect(result.success).toBe(false)
  })

  it('hero schema accepts valid data', () => {
    const result = SECTION_VALUE_SCHEMAS.hero.safeParse({
      title: 'Welcome to Outvers',
      subtitle: 'Adventure awaits',
    })
    expect(result.success).toBe(true)
  })

  it('announcement_bar schema accepts empty object', () => {
    const result = SECTION_VALUE_SCHEMAS.announcement_bar.safeParse({})
    expect(result.success).toBe(true)
  })

  it('branding schema rejects invalid URL', () => {
    const result = SECTION_VALUE_SCHEMAS.branding.safeParse({
      logoUrl: 'not-a-url',
    })
    expect(result.success).toBe(false)
  })
})

describe('Admin site builder actions', () => {
  let db: TestDB
  let teardown: () => Promise<void>

  beforeAll(async () => {
    const setup = await setupTestDb()
    db = setup.db
    teardown = setup.teardown
  })

  afterAll(async () => {
    await teardown()
  })

  beforeEach(async () => {
    await db.execute(
      sql`TRUNCATE TABLE audit_logs, site_content, users CASCADE`,
    )
  })

  // ── Save section (create) ────────────────────────────────────────

  describe('executeSaveSection - create', () => {
    it('creates a site_content row with correct section/key', async () => {
      const adminId = await seedAdmin(db)

      const result = await executeSaveSection(db, adminId, {
        section: 'hero',
        key: 'default',
        value: { title: 'Welcome to Outvers', subtitle: 'Book adventures' },
      })

      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.version).toBe(1)
      }

      const rows = await db.select().from(siteContent)
      expect(rows).toHaveLength(1)
      expect(rows[0]!.section).toBe('hero')
      expect(rows[0]!.key).toBe('default')
      expect(rows[0]!.locale).toBe('en')
      expect(rows[0]!.version).toBe(1)
      expect(rows[0]!.updatedByAdminId).toBe(adminId)
      expect((rows[0]!.value as Record<string, unknown>).title).toBe('Welcome to Outvers')
    })

    it('writes audit log on creation', async () => {
      const adminId = await seedAdmin(db)

      await executeSaveSection(db, adminId, {
        section: 'footer',
        key: 'default',
        value: { companyName: 'Outvers' },
      })

      const logs = await db.select().from(auditLogs)
      expect(logs).toHaveLength(1)
      expect(logs[0]!.action).toBe('admin.site_content.create')
      expect(logs[0]!.actorUserId).toBe(adminId)
      expect(logs[0]!.entityType).toBe('site_content')
      expect(logs[0]!.entityId).toBe('footer/default/en')
    })

    it('creates rows for different locales independently', async () => {
      const adminId = await seedAdmin(db)

      await executeSaveSection(db, adminId, {
        section: 'hero',
        key: 'default',
        value: { title: 'English title' },
        locale: 'en',
      })

      await executeSaveSection(db, adminId, {
        section: 'hero',
        key: 'default',
        value: { title: 'Hindi title' },
        locale: 'hi',
      })

      const rows = await db.select().from(siteContent)
      expect(rows).toHaveLength(2)
    })
  })

  // ── Save section (update + version tracking) ─────────────────────

  describe('executeSaveSection - update', () => {
    it('version increments on update', async () => {
      const adminId = await seedAdmin(db)

      const r1 = await executeSaveSection(db, adminId, {
        section: 'hero',
        key: 'default',
        value: { title: 'V1' },
      })
      expect(r1.ok).toBe(true)
      if (r1.ok) expect(r1.version).toBe(1)

      const r2 = await executeSaveSection(db, adminId, {
        section: 'hero',
        key: 'default',
        value: { title: 'V2' },
      })
      expect(r2.ok).toBe(true)
      if (r2.ok) expect(r2.version).toBe(2)

      const r3 = await executeSaveSection(db, adminId, {
        section: 'hero',
        key: 'default',
        value: { title: 'V3' },
      })
      expect(r3.ok).toBe(true)
      if (r3.ok) expect(r3.version).toBe(3)

      const rows = await db.select().from(siteContent)
      expect(rows).toHaveLength(1)
      expect(rows[0]!.version).toBe(3)
      expect((rows[0]!.value as Record<string, unknown>).title).toBe('V3')
    })

    it('writes audit log with "update" action on overwrite', async () => {
      const adminId = await seedAdmin(db)

      await executeSaveSection(db, adminId, {
        section: 'seo',
        key: 'default',
        value: { defaultTitle: 'Old' },
      })

      await executeSaveSection(db, adminId, {
        section: 'seo',
        key: 'default',
        value: { defaultTitle: 'New' },
      })

      const logs = await db
        .select()
        .from(auditLogs)
        .orderBy(auditLogs.createdAt)
      expect(logs).toHaveLength(2)
      expect(logs[0]!.action).toBe('admin.site_content.create')
      expect(logs[1]!.action).toBe('admin.site_content.update')
    })

    it('tracks updated_by_admin_id across updates', async () => {
      const admin1 = await seedAdmin(db)
      const admin2 = 'admin_site_2'
      await db.insert(users).values({ id: admin2, email: 'admin-site2@test.com' })

      await executeSaveSection(db, admin1, {
        section: 'branding',
        key: 'default',
        value: { siteName: 'Outvers' },
      })

      await executeSaveSection(db, admin2, {
        section: 'branding',
        key: 'default',
        value: { siteName: 'Outvers Updated' },
      })

      const rows = await db.select().from(siteContent)
      expect(rows).toHaveLength(1)
      expect(rows[0]!.updatedByAdminId).toBe(admin2)
    })
  })

  // ── Validation ───────────────────────────────────────────────────

  describe('executeSaveSection - validation', () => {
    it('rejects invalid section', async () => {
      const adminId = await seedAdmin(db)

      const result = await executeSaveSection(db, adminId, {
        section: 'invalid' as 'hero',
        key: 'default',
        value: { title: 'test' },
      })

      expect(result.ok).toBe(false)
    })

    it('rejects empty key', async () => {
      const adminId = await seedAdmin(db)

      const result = await executeSaveSection(db, adminId, {
        section: 'hero',
        key: '',
        value: { title: 'test' },
      })

      expect(result.ok).toBe(false)
    })

    it('rejects hero value without required title', async () => {
      const adminId = await seedAdmin(db)

      const result = await executeSaveSection(db, adminId, {
        section: 'hero',
        key: 'default',
        value: { subtitle: 'Only subtitle, no title' },
      })

      expect(result.ok).toBe(false)
      if (!result.ok) {
        // Hero schema requires a non-empty title string
        expect(result.error).toBeTruthy()
      }

      // No row should have been written
      const rows = await db.select().from(siteContent)
      expect(rows).toHaveLength(0)
    })

    it('rejects branding value with invalid logoUrl', async () => {
      const adminId = await seedAdmin(db)

      const result = await executeSaveSection(db, adminId, {
        section: 'branding',
        key: 'default',
        value: { logoUrl: 'not-a-url' },
      })

      expect(result.ok).toBe(false)
    })
  })

  // ── Load section ─────────────────────────────────────────────────

  describe('executeLoadSection', () => {
    it('returns empty array when no content exists', async () => {
      const rows = await executeLoadSection(db, 'hero', 'en')
      expect(rows).toEqual([])
    })

    it('returns all rows for a section and locale', async () => {
      const adminId = await seedAdmin(db)

      await executeSaveSection(db, adminId, {
        section: 'footer',
        key: 'main',
        value: { companyName: 'Outvers' },
      })

      await executeSaveSection(db, adminId, {
        section: 'footer',
        key: 'legal',
        value: { copyrightText: '2026 Outvers' },
      })

      // Different section — should not appear
      await executeSaveSection(db, adminId, {
        section: 'hero',
        key: 'default',
        value: { title: 'Hero' },
      })

      const rows = await executeLoadSection(db, 'footer', 'en')
      expect(rows).toHaveLength(2)
      expect(rows.map((r) => r.key).sort()).toEqual(['legal', 'main'])
    })

    it('filters by locale', async () => {
      const adminId = await seedAdmin(db)

      await executeSaveSection(db, adminId, {
        section: 'hero',
        key: 'default',
        value: { title: 'EN' },
        locale: 'en',
      })

      await executeSaveSection(db, adminId, {
        section: 'hero',
        key: 'default',
        value: { title: 'HI' },
        locale: 'hi',
      })

      const enRows = await executeLoadSection(db, 'hero', 'en')
      expect(enRows).toHaveLength(1)
      expect((enRows[0]!.value as Record<string, unknown>).title).toBe('EN')

      const hiRows = await executeLoadSection(db, 'hero', 'hi')
      expect(hiRows).toHaveLength(1)
      expect((hiRows[0]!.value as Record<string, unknown>).title).toBe('HI')
    })
  })
})
