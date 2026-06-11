import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { glob } from 'glob'

/**
 * Hero contract (issue 02 / DECISION D1, simplified per owner screenshots
 * 2026-06-11 — Headout-style).
 *
 * The homepage hero stays marketplace-credible but minimal:
 *   - H1 is the KEYWORD line "Book Verified Adventure Experiences Across India"
 *     (the `HomePage.hero.title` key, which the route renders as the single
 *     <h1>).
 *   - "Book the scene you want to live." is kept as a SECONDARY brand line
 *     (`HomePage.hero.brandLine`) — present, but NOT the H1.
 *   - The search bar IS the call to action: ONE single-field GET form
 *     (HomeHeroSearch) replaces the issue-02 CTA buttons AND the issue-09
 *     4-field module + popular/trust/category chip rows (all judged clutter
 *     in the owner's screenshot pass). Supply-side "List your experience"
 *     lives permanently in the header + footer instead.
 *   - The subtitle names the four flagship activities and the marketplace
 *     promises (verified Vendors, transparent pricing, real-time availability).
 *
 * Layers asserted:
 *   1. en.json copy contract (the shipped source-of-truth strings).
 *   2. The route source (`page.tsx`) wiring: exactly one <h1>, bound to
 *      hero.title; the brand line outside any <h1>; the single hero search
 *      mounted; no hero CTA buttons / chip rows; the compact trust strip
 *      directly after the hero, before Popular destinations.
 *   3. Locale parity: every locale file carries the hero keys.
 */

const ROOT = resolve(__dirname, '../../..')
const EN_PATH = resolve(ROOT, 'lib/i18n/messages/en.json')
const PAGE_PATH = resolve(ROOT, 'app/[locale]/(marketing)/page.tsx')
const MESSAGES_GLOB = 'lib/i18n/messages/*.json'

const KEYWORD_H1 = 'Book Verified Adventure Experiences Across India'
const BRAND_LINE = 'Book the scene you'

function get(obj: Record<string, unknown>, dotted: string): unknown {
  return dotted.split('.').reduce<unknown>((acc, key) => {
    if (acc && typeof acc === 'object') {
      return (acc as Record<string, unknown>)[key]
    }
    return undefined
  }, obj)
}

function loadEn(): Record<string, unknown> {
  return JSON.parse(readFileSync(EN_PATH, 'utf-8')) as Record<string, unknown>
}

function localeFiles(): { locale: string; json: Record<string, unknown> }[] {
  const paths = glob.sync(MESSAGES_GLOB, { cwd: ROOT }).map((p) => resolve(ROOT, p))
  expect(paths.length).toBeGreaterThan(0)
  return paths.map((path) => ({
    locale: path.replace(/.*\/([a-z]+)\.json$/, '$1'),
    json: JSON.parse(readFileSync(path, 'utf-8')) as Record<string, unknown>,
  }))
}

describe('hero rework copy contract (en.json)', () => {
  const en = loadEn()

  it('hero.title is the keyword H1 line', () => {
    expect(get(en, 'HomePage.hero.title')).toBe(KEYWORD_H1)
  })

  it('hero.brandLine is the secondary emotional brand line', () => {
    const brand = get(en, 'HomePage.hero.brandLine')
    expect(typeof brand).toBe('string')
    expect(brand as string).toContain(BRAND_LINE)
  })

  it('hero.subtitle names the flagship activities and marketplace promises', () => {
    const subtitle = get(en, 'HomePage.hero.subtitle') as string
    expect(typeof subtitle).toBe('string')
    for (const word of ['rafting', 'paragliding', 'scuba', 'trekking']) {
      expect(subtitle.toLowerCase()).toContain(word)
    }
    // Verified Vendors (never "operators"), transparent pricing, real-time
    // availability — the marketplace-credible promise.
    expect(subtitle).toMatch(/verified vendors/i)
    expect(subtitle).toMatch(/transparent pricing/i)
    expect(subtitle).toMatch(/real-time availability/i)
  })

  it('hero copy never says "operator" (domain _Avoid_)', () => {
    const hero = get(en, 'HomePage.hero') as Record<string, unknown>
    expect(JSON.stringify(hero)).not.toMatch(/operator/i)
  })
})

describe('hero rework route wiring (page.tsx)', () => {
  const source = readFileSync(PAGE_PATH, 'utf-8')

  it('renders exactly one <h1>', () => {
    const opens = source.match(/<h1[\s>]/g) ?? []
    expect(opens.length).toBe(1)
  })

  it('the <h1> binds to hero.title (the keyword line)', () => {
    // <h1 ...> ... {t('hero.title')} ... </h1>
    const h1Block = source.match(/<h1[\s\S]*?<\/h1>/)
    expect(h1Block).not.toBeNull()
    expect(h1Block?.[0]).toContain("t('hero.title')")
  })

  it('renders the brand line via hero.brandLine outside any <h1>', () => {
    expect(source).toContain("t('hero.brandLine')")
    const h1Block = source.match(/<h1[\s\S]*?<\/h1>/)
    expect(h1Block?.[0]).not.toContain("t('hero.brandLine')")
  })

  it('mounts the single hero search and drops the CTA buttons (screenshots 2026-06-11)', () => {
    expect(source).toContain('HomeHeroSearch')
    expect(source).not.toContain("t('hero.exploreCta')")
    expect(source).not.toContain("t('hero.listCta')")
  })

  it('drops the 4-field module and every hero chip row (clutter per owner)', () => {
    expect(source).not.toContain('HomeStructuredSearch')
    expect(source).not.toContain("tHomeSearch('popular.heading')")
    expect(source).not.toContain('trustChips')
    expect(source).not.toContain('getActivityIcon')
  })

  it('renders the compact trust strip directly after the hero, before Popular destinations', () => {
    const trustIdx = source.indexOf('<HomeTrust />')
    const destinationsIdx = source.indexOf("t('destinations.heading')")
    const featuredIdx = source.indexOf("t('featured.heading')")
    expect(trustIdx).toBeGreaterThan(-1)
    expect(destinationsIdx).toBeGreaterThan(-1)
    expect(trustIdx).toBeLessThan(destinationsIdx)
    expect(destinationsIdx).toBeLessThan(featuredIdx)
  })
})

describe('hero rework locale parity', () => {
  for (const { locale, json } of localeFiles()) {
    it(`${locale}.json carries hero.title, brandLine, exploreCta, listCta`, () => {
      for (const key of [
        'HomePage.hero.title',
        'HomePage.hero.brandLine',
        'HomePage.hero.exploreCta',
        'HomePage.hero.listCta',
      ]) {
        const value = get(json, key)
        expect(typeof value, `${locale} missing ${key}`).toBe('string')
        expect((value as string).length).toBeGreaterThan(0)
      }
    })

    it(`${locale}.json hero copy never says "operator"`, () => {
      const hero = get(json, 'HomePage.hero') as Record<string, unknown>
      expect(JSON.stringify(hero)).not.toMatch(/operator/i)
    })
  }
})
