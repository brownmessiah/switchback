import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  CANCELLATION_POLICY_PATH,
  LEGAL_PAGES,
  LEGAL_PAGE_PATHS,
} from '@/lib/legal/content'
import { STATIC_PUBLIC_PATHS } from '@/lib/seo/sitemap'

/**
 * Wiring contract for the four legal route pages (issue 07):
 *   /terms, /privacy, /refund-cancellation, /vendor-terms.
 *
 * Copy/facts are pinned in legal-content.test.ts + legal-copy.test.ts; this
 * file asserts the *plumbing*: the bare-path route files exist under the
 * (marketing) group, follow the marketing SSR template (setRequestLocale,
 * namespaced getTranslations, generateMetadata, breadcrumbList JSON-LD), are
 * indexable (no noindex), are in the sitemap, and that /refund-cancellation
 * links the existing /cancellation-policy calculator page.
 */

const ROOT = resolve(__dirname, '../../..')

const PAGE_FILES: Record<string, string> = {
  terms: 'app/[locale]/(marketing)/terms/page.tsx',
  privacy: 'app/[locale]/(marketing)/privacy/page.tsx',
  'refund-cancellation': 'app/[locale]/(marketing)/refund-cancellation/page.tsx',
  'vendor-terms': 'app/[locale]/(marketing)/vendor-terms/page.tsx',
}

describe('the four legal route files exist under [locale]/(marketing)', () => {
  for (const page of LEGAL_PAGES) {
    it(`${page.id} page exists at ${PAGE_FILES[page.id]}`, () => {
      expect(existsSync(resolve(ROOT, PAGE_FILES[page.id]))).toBe(true)
    })
  }
})

describe('each legal page follows the marketing SSR + SEO template', () => {
  for (const page of LEGAL_PAGES) {
    const src = () => readFileSync(resolve(ROOT, PAGE_FILES[page.id]), 'utf-8')

    it(`${page.id} sets the request locale`, () => {
      expect(src()).toContain('setRequestLocale')
    })

    it(`${page.id} reads its namespace "${page.namespace}" via getTranslations`, () => {
      const content = src()
      expect(content).toContain('getTranslations')
      expect(content).toContain(page.namespace)
    })

    it(`${page.id} exports generateMetadata (indexable — no noindex)`, () => {
      const content = src()
      expect(content).toContain('export async function generateMetadata')
      // The legal drafts are crawlable: they must NOT opt out of indexing.
      expect(content).not.toMatch(/noindex/i)
      expect(content).not.toMatch(/robots:\s*\{[^}]*index:\s*false/i)
    })

    it(`${page.id} emits a BreadcrumbList JSON-LD`, () => {
      const content = src()
      expect(content).toContain('breadcrumbList')
      expect(content).toContain('application/ld+json')
    })

    it(`${page.id} renders the shared "pending final legal review" notice key`, () => {
      expect(src()).toContain('reviewNotice')
    })
  }
})

describe('/refund-cancellation links the existing /cancellation-policy page', () => {
  it('references the canonical calculator path', () => {
    const content = readFileSync(
      resolve(ROOT, PAGE_FILES['refund-cancellation']),
      'utf-8',
    )
    expect(content).toContain(CANCELLATION_POLICY_PATH)
    expect(CANCELLATION_POLICY_PATH).toBe('/cancellation-policy')
  })
})

describe('all four legal paths are in the public sitemap', () => {
  for (const path of LEGAL_PAGE_PATHS) {
    it(`STATIC_PUBLIC_PATHS includes ${path}`, () => {
      expect(STATIC_PUBLIC_PATHS).toContain(path)
    })
  }
})
