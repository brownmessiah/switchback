import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { glob } from 'glob'

/**
 * Hero rework contract (issue 02 / DECISION D1).
 *
 * The homepage hero is repositioned from emotional-only to
 * marketplace-credible:
 *   - H1 is the KEYWORD line "Book Verified Adventure Experiences Across India"
 *     (the `HomePage.hero.title` key, which the route renders as the single
 *     <h1>).
 *   - "Book the scene you want to live." is kept as a SECONDARY brand line
 *     (`HomePage.hero.brandLine`) — present, but NOT the H1.
 *   - Two explicit CTAs: primary "Explore Experiences" -> /search; secondary
 *     "List Your Experience" -> interim /vendor/onboarding (TODO #06 re-points
 *     to /vendor-partner).
 *   - The subtitle names the four flagship activities and the marketplace
 *     promises (verified Vendors, transparent pricing, real-time availability).
 *
 * Two layers are asserted:
 *   1. en.json copy contract (the shipped source-of-truth strings).
 *   2. The route source (`page.tsx`) wiring: exactly one <h1>, bound to
 *      hero.title; the brand line rendered via hero.brandLine and NOT as an
 *      <h1>; both CTAs routed + carrying .min-tap; the interim TODO marker.
 *   3. Locale parity: every locale file carries the new hero keys.
 */

const ROOT = resolve(__dirname, '../../..')
const EN_PATH = resolve(ROOT, 'lib/i18n/messages/en.json')
const PAGE_PATH = resolve(ROOT, 'app/[locale]/(marketing)/page.tsx')
const MESSAGES_GLOB = 'lib/i18n/messages/*.json'

const KEYWORD_H1 = 'Book Verified Adventure Experiences Across India'
const BRAND_LINE = 'Book the scene you'
const EXPLORE_CTA = 'Explore Experiences'
const LIST_CTA = 'List Your Experience'

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

  it('hero.exploreCta === "Explore Experiences"', () => {
    expect(get(en, 'HomePage.hero.exploreCta')).toBe(EXPLORE_CTA)
  })

  it('hero.listCta === "List Your Experience"', () => {
    expect(get(en, 'HomePage.hero.listCta')).toBe(LIST_CTA)
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

  it('primary CTA "Explore Experiences" routes to /search', () => {
    expect(source).toContain("t('hero.exploreCta')")
    expect(source).toMatch(/href="\/search"/)
  })

  it('secondary CTA "List Your Experience" routes to interim /vendor/onboarding', () => {
    expect(source).toContain("t('hero.listCta')")
    expect(source).toMatch(/href="\/vendor\/onboarding"/)
  })

  it('leaves a TODO(#06) marker to re-point the secondary CTA to /vendor-partner', () => {
    expect(source).toMatch(/TODO\(#06\)[\s\S]*?\/vendor-partner/)
  })

  it('both CTAs carry the .min-tap utility for mobile tap targets', () => {
    // The two CTA links each need min-tap; count anchors that reference the
    // CTA destinations and the min-tap class near them.
    const exploreCta = source.match(/href="\/search"[\s\S]*?min-tap|min-tap[\s\S]*?href="\/search"/)
    const listCta = source.match(
      /href="\/vendor\/onboarding"[\s\S]*?min-tap|min-tap[\s\S]*?href="\/vendor\/onboarding"/,
    )
    expect(exploreCta).not.toBeNull()
    expect(listCta).not.toBeNull()
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
