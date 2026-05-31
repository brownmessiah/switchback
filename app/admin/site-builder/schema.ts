/**
 * Site-builder validation schemas + value types.
 *
 * This is a plain (non-`'use server'`) sibling module. Next.js requires every
 * export of a `'use server'` file to be an async Server Function, so any
 * runtime value/schema export (like `SECTION_VALUE_SCHEMAS`) MUST live here and
 * be imported by `actions.ts` — exporting a non-async value from the
 * `'use server'` module makes every Server Action in it fail at build/runtime.
 *
 * See the sibling `app/admin/loyalty/grant-logic.ts` for the same pattern.
 */

import { z } from 'zod'

import { SITE_SECTIONS, type SiteSection } from '@/db/schema/site-content'

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

export const saveSectionSchema = z.object({
  section: z.enum(SITE_SECTIONS, { message: 'Invalid section.' }),
  key: z.string().min(1, 'Key is required.'),
  value: z.record(z.string(), z.unknown()),
  locale: z.string().default('en'),
})

export type SaveSectionInput = z.input<typeof saveSectionSchema>

// ── Load row shape ──────────────────────────────────────────────────

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
