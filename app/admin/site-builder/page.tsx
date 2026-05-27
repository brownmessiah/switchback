import { eq } from 'drizzle-orm'

import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { db } from '@/db/client'
import { siteContent, SITE_SECTIONS, type SiteSection } from '@/db/schema/site-content'

import { SectionForm } from './section-form'

// ── Labels ──────────────────────────────────────────────────────────

const SECTION_LABELS: Record<SiteSection, string> = {
  hero: 'Hero',
  announcement_bar: 'Announcement',
  homepage: 'Homepage',
  branding: 'Branding',
  seo: 'SEO',
  footer: 'Footer',
}

// ── Page ────────────────────────────────────────────────────────────

export default async function SiteBuilderPage() {
  // Load all content rows for the default locale
  const allRows = await db
    .select()
    .from(siteContent)
    .where(eq(siteContent.locale, 'en'))

  // Build a map: section -> { values, version }
  const sectionData = new Map<
    SiteSection,
    { values: Record<string, unknown>; version: number }
  >()

  for (const row of allRows) {
    const section = row.section as SiteSection
    if (!SITE_SECTIONS.includes(section)) continue

    // We store one row per (section, key, locale).
    // For the default key, merge values directly.
    if (row.key === 'default') {
      sectionData.set(section, {
        values: (row.value ?? {}) as Record<string, unknown>,
        version: row.version,
      })
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Site Builder</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Manage hero, announcements, homepage layout, branding, SEO, and
          footer content. Each section saves independently.
        </p>
      </div>

      <Tabs defaultValue="hero">
        <TabsList className="flex-wrap">
          {SITE_SECTIONS.map((section) => (
            <TabsTrigger key={section} value={section}>
              {SECTION_LABELS[section]}
            </TabsTrigger>
          ))}
        </TabsList>

        {SITE_SECTIONS.map((section) => {
          const data = sectionData.get(section)
          return (
            <TabsContent key={section} value={section}>
              <SectionForm
                section={section}
                initialValues={data?.values ?? {}}
                currentVersion={data?.version ?? null}
              />
            </TabsContent>
          )
        })}
      </Tabs>
    </div>
  )
}
