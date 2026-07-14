import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { glob } from 'glob'

/**
 * Hero copy contract (home-redesign issue 01, owner brief CR2/CR3 + D4,
 * 2026-07-14 — supersedes the issue-02/D1 keyword-H1 contract).
 *
 * The H1 softens to the brand-forward "Book best experiences around you"
 * and the visible subtitle is removed (owner declutter directive). The SEO
 * keywords both lines carried (verified / adventure / experiences / India +
 * the four flagship activities) are PRESERVED elsewhere (decision D4):
 *   - `Metadata.title` + `Metadata.description` (the homepage <title> +
 *     meta description via generateMetadata);
 *   - the Organization JSON-LD description in page.tsx;
 *   - a visually-hidden keyword-bearing <h2> (`hero.seoSubheading`) in the
 *     hero, so the page keeps a crawlable keyword heading without visual
 *     clutter.
 *
 * Layers asserted:
 *   1. en.json copy contract (the shipped source-of-truth strings).
 *   2. The route source (`page.tsx`) wiring: exactly one <h1>, bound to
 *      hero.title; NO subtitle render; the sr-only keyword <h2>; the brand
 *      line outside any <h1> (it survives until issue 05's carousel); the
 *      single hero search mounted; no hero CTA buttons / chip rows; the
 *      keyword-bearing Organization JSON-LD description.
 *   3. Locale parity: every locale carries the hero keys; none carries the
 *      removed `hero.subtitle`.
 */

const ROOT = resolve(__dirname, '../../..')
const EN_PATH = resolve(ROOT, 'lib/i18n/messages/en.json')
const PAGE_PATH = resolve(ROOT, 'app/[locale]/(marketing)/page.tsx')
const MESSAGES_GLOB = 'lib/i18n/messages/*.json'

const NEW_H1 = 'Book best experiences around you'
const BRAND_LINE = 'Book the scene you'
const FLAGSHIP_ACTIVITIES = ['rafting', 'paragliding', 'scuba', 'trekking']

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

describe('hero copy contract (en.json)', () => {
  const en = loadEn()

  it('hero.title is the brand-forward H1 line (CR2)', () => {
    expect(get(en, 'HomePage.hero.title')).toBe(NEW_H1)
  })

  it('hero.subtitle is removed (CR3)', () => {
    expect(get(en, 'HomePage.hero.subtitle')).toBeUndefined()
  })

  it('hero.brandLine survives as the secondary emotional line (until issue 05)', () => {
    const brand = get(en, 'HomePage.hero.brandLine')
    expect(typeof brand).toBe('string')
    expect(brand as string).toContain(BRAND_LINE)
  })

  it('hero.seoSubheading carries the keywords the H1/subtitle dropped (D4)', () => {
    const seo = get(en, 'HomePage.hero.seoSubheading') as string
    expect(typeof seo).toBe('string')
    expect(seo).toMatch(/verified/i)
    expect(seo).toMatch(/adventure experiences/i)
    expect(seo).toMatch(/india/i)
    for (const word of FLAGSHIP_ACTIVITIES) {
      expect(seo.toLowerCase()).toContain(word)
    }
  })

  it('Metadata title+description preserve the keyword set (D4)', () => {
    const title = get(en, 'Metadata.title') as string
    const description = get(en, 'Metadata.description') as string
    expect(title).toMatch(/verified adventure experiences/i)
    expect(title).toMatch(/india/i)
    expect(description).toMatch(/india/i)
    for (const word of FLAGSHIP_ACTIVITIES) {
      expect(description.toLowerCase()).toContain(word)
    }
  })

  it('hero copy never says "operator" (domain _Avoid_)', () => {
    const hero = get(en, 'HomePage.hero') as Record<string, unknown>
    expect(JSON.stringify(hero)).not.toMatch(/operator/i)
  })
})

describe('hero route wiring (page.tsx)', () => {
  const source = readFileSync(PAGE_PATH, 'utf-8')

  it('renders exactly one <h1>', () => {
    const opens = source.match(/<h1[\s>]/g) ?? []
    expect(opens.length).toBe(1)
  })

  it('the <h1> binds to hero.title', () => {
    const h1Block = source.match(/<h1[\s\S]*?<\/h1>/)
    expect(h1Block).not.toBeNull()
    expect(h1Block?.[0]).toContain("t('hero.title')")
  })

  it('no longer renders the subtitle (CR3)', () => {
    expect(source).not.toContain("t('hero.subtitle')")
  })

  it('renders the visually-hidden keyword <h2> bound to hero.seoSubheading (D4)', () => {
    const h2Block = source.match(/<h2[^>]*sr-only[\s\S]*?<\/h2>/)
    expect(h2Block).not.toBeNull()
    expect(h2Block?.[0]).toContain("t('hero.seoSubheading')")
  })

  it('renders the brand line via hero.brandLine outside any <h1>', () => {
    expect(source).toContain("t('hero.brandLine')")
    const h1Block = source.match(/<h1[\s\S]*?<\/h1>/)
    expect(h1Block?.[0]).not.toContain("t('hero.brandLine')")
  })

  it('the Organization JSON-LD description stays keyword-bearing (D4)', () => {
    // Pin the exact description literal passed to organization() — a direct
    // string assertion is robust against call-site reshuffles (a lazy regex
    // over the call would truncate at any nested `})`).
    expect(source).toContain('Indian adventure-activity marketplace')
    expect(source).toContain(
      'rafting, paragliding, scuba, trekking from KYC-verified vendors'
    )
  })

  // The trust-strip ordering guardrail moved to
  // tests/unit/components/home-trust-sections.test.tsx ("placement"): since
  // issue 02 the strip closes the page (after HomeHowItWorks), so it is no
  // longer part of the hero's first-screen contract.

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
})

describe('hero locale parity', () => {
  for (const { locale, json } of localeFiles()) {
    it(`${locale}.json carries hero.title, brandLine, seoSubheading, exploreCta, listCta`, () => {
      for (const key of [
        'HomePage.hero.title',
        'HomePage.hero.brandLine',
        'HomePage.hero.seoSubheading',
        'HomePage.hero.exploreCta',
        'HomePage.hero.listCta',
      ]) {
        const value = get(json, key)
        expect(typeof value, `${locale} missing ${key}`).toBe('string')
        expect((value as string).length).toBeGreaterThan(0)
      }
    })

    it(`${locale}.json no longer carries the removed hero.subtitle`, () => {
      expect(get(json, 'HomePage.hero.subtitle'), `${locale} still has hero.subtitle`).toBeUndefined()
    })

    it(`${locale}.json hero copy never says "operator"`, () => {
      const hero = get(json, 'HomePage.hero') as Record<string, unknown>
      expect(JSON.stringify(hero)).not.toMatch(/operator/i)
    })
  }
})
