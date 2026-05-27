import { existsSync } from 'node:fs'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = resolve(__dirname, '../../..')

/**
 * Tests that all six remaining public marketing routes have been moved
 * under app/[locale]/(marketing)/ and that message files contain the
 * required namespaces.
 */

// ---- Route file existence ----

describe('public routes under [locale]/(marketing)', () => {
  const routes = [
    'app/[locale]/(marketing)/adventure/[slug]/page.tsx',
    'app/[locale]/(marketing)/experience/[slug]/page.tsx',
    'app/[locale]/(marketing)/experience/[slug]/loading.tsx',
    'app/[locale]/(marketing)/search/page.tsx',
    'app/[locale]/(marketing)/search/loading.tsx',
    'app/[locale]/(marketing)/sign-in/page.tsx',
    'app/[locale]/(marketing)/sign-in/sign-in-form.tsx',
    'app/[locale]/(marketing)/vendor/[slug]/page.tsx',
    'app/[locale]/(marketing)/cancellation-policy/page.tsx',
  ]

  for (const route of routes) {
    it(`${route} exists`, () => {
      expect(existsSync(resolve(ROOT, route))).toBe(true)
    })
  }

  it('old app/(marketing)/ routes have been removed', () => {
    const oldRoutes = [
      'app/(marketing)/adventure/[slug]/page.tsx',
      'app/(marketing)/experience/[slug]/page.tsx',
      'app/(marketing)/search/page.tsx',
      'app/(marketing)/sign-in/page.tsx',
      'app/(marketing)/vendor/[slug]/page.tsx',
      'app/(marketing)/cancellation-policy/page.tsx',
    ]
    for (const route of oldRoutes) {
      expect(existsSync(resolve(ROOT, route))).toBe(false)
    }
  })
})

// ---- Message file namespaces ----

describe('message file namespaces for public routes', () => {
  const enMessages = JSON.parse(
    readFileSync(resolve(ROOT, 'lib/i18n/messages/en.json'), 'utf-8'),
  )
  const hiMessages = JSON.parse(
    readFileSync(resolve(ROOT, 'lib/i18n/messages/hi.json'), 'utf-8'),
  )

  const requiredNamespaces = [
    'AdventurePage',
    'ExperiencePage',
    'SearchPage',
    'SignInPage',
    'VendorPage',
    'CancellationPolicyPage',
  ]

  for (const ns of requiredNamespaces) {
    it(`en.json has namespace "${ns}"`, () => {
      expect(enMessages).toHaveProperty(ns)
      expect(typeof enMessages[ns]).toBe('object')
    })

    it(`hi.json has namespace "${ns}"`, () => {
      expect(hiMessages).toHaveProperty(ns)
      expect(typeof hiMessages[ns]).toBe('object')
    })
  }

  // Verify key parity: every key in en.json should exist in hi.json
  for (const ns of requiredNamespaces) {
    it(`hi.json has all keys from en.json for "${ns}"`, () => {
      const enKeys = enMessages[ns] ? flattenKeys(enMessages[ns]) : []
      const hiKeys = hiMessages[ns] ? flattenKeys(hiMessages[ns]) : []

      for (const key of enKeys) {
        expect(hiKeys).toContain(key)
      }
    })
  }
})

// ---- Page components accept locale param ----

describe('page components accept locale param', () => {
  const pagesWithLocaleParam = [
    'app/[locale]/(marketing)/adventure/[slug]/page.tsx',
    'app/[locale]/(marketing)/experience/[slug]/page.tsx',
    'app/[locale]/(marketing)/search/page.tsx',
    'app/[locale]/(marketing)/sign-in/page.tsx',
    'app/[locale]/(marketing)/vendor/[slug]/page.tsx',
    'app/[locale]/(marketing)/cancellation-policy/page.tsx',
  ]

  for (const pagePath of pagesWithLocaleParam) {
    it(`${pagePath} references locale param`, () => {
      const content = readFileSync(resolve(ROOT, pagePath), 'utf-8')
      expect(content).toContain('locale')
    })
  }

  const serverPages = [
    'app/[locale]/(marketing)/adventure/[slug]/page.tsx',
    'app/[locale]/(marketing)/experience/[slug]/page.tsx',
    'app/[locale]/(marketing)/search/page.tsx',
    'app/[locale]/(marketing)/vendor/[slug]/page.tsx',
    'app/[locale]/(marketing)/cancellation-policy/page.tsx',
  ]

  for (const pagePath of serverPages) {
    it(`${pagePath} calls setRequestLocale`, () => {
      const content = readFileSync(resolve(ROOT, pagePath), 'utf-8')
      expect(content).toContain('setRequestLocale')
    })
  }
})

// ---- Metadata ----

describe('generateMetadata uses getTranslations', () => {
  const pagesWithMetadata = [
    'app/[locale]/(marketing)/search/page.tsx',
    'app/[locale]/(marketing)/sign-in/page.tsx',
    'app/[locale]/(marketing)/cancellation-policy/page.tsx',
  ]

  for (const pagePath of pagesWithMetadata) {
    it(`${pagePath} imports getTranslations from next-intl/server`, () => {
      const content = readFileSync(resolve(ROOT, pagePath), 'utf-8')
      expect(content).toContain('getTranslations')
    })
  }
})

// ---- Helper ----

function flattenKeys(obj: Record<string, unknown>, prefix = ''): string[] {
  const keys: string[] = []
  for (const [k, v] of Object.entries(obj)) {
    const fullKey = prefix ? `${prefix}.${k}` : k
    if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
      keys.push(...flattenKeys(v as Record<string, unknown>, fullKey))
    } else {
      keys.push(fullKey)
    }
  }
  return keys
}
