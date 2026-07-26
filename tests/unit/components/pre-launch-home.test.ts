import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

/**
 * Pre-launch home composition contract (launch-readiness 04).
 *
 * Same source-text technique the existing home-page contract tests use
 * (tests/unit/i18n/hero-rework.test.ts et al): the composition itself is
 * the thing under test, and it is what a reviewer would otherwise have
 * to eyeball.
 */

const ROOT = resolve(__dirname, '../../..')
const PAGE_PATH = resolve(ROOT, 'app/[locale]/(marketing)/page.tsx')
const PRELAUNCH_PATH = resolve(ROOT, 'components/home/pre-launch-home.tsx')

/**
 * Comments are stripped before asserting: these tests are about the
 * rendered composition, and a doc comment that merely *mentions* a
 * dropped element (e.g. explaining why the hero search is gone) must not
 * read as that element being present.
 */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, '')
    .replace(/^\s*\/\/.*$/gm, '')
}

const pageSource = stripComments(readFileSync(PAGE_PATH, 'utf-8'))
const preLaunchSource = stripComments(readFileSync(PRELAUNCH_PATH, 'utf-8'))

describe('home page marketplace-state branch', () => {
  it('derives composition from getMarketplaceState, not a manual flag', () => {
    expect(pageSource).toContain('getMarketplaceState')
    // No env/config/feature-flag escape hatch: the switch must be data.
    expect(pageSource).not.toMatch(/PRE_?LAUNCH|preLaunchMode|isPreLaunch\s*=/)
  })

  it('returns the pre-launch composition before building the live one', () => {
    const branchIdx = pageSource.indexOf('getMarketplaceState')
    const loadIdx = pageSource.indexOf('loadHomePageData(db)')
    expect(branchIdx).toBeGreaterThan(-1)
    expect(loadIdx).toBeGreaterThan(-1)
    // Short-circuit: the live-only data load must not run pre-launch.
    expect(branchIdx).toBeLessThan(loadIdx)
  })

  it('keeps the live composition inline in page.tsx (its contract tests read this file)', () => {
    // These are the anchors the four existing source-text tests pin.
    expect(pageSource).toContain("t('hero.title')")
    expect(pageSource).toContain('HomeHeroSearch')
    expect(pageSource).toContain('<HomeFeatureCarousel')
    expect(pageSource).toMatch(/<HomeTrust \/>\s*<\/main>/)
    const opens = pageSource.match(/<h1[\s>]/g) ?? []
    expect(opens.length).toBe(1)
  })
})

describe('pre-launch composition', () => {
  it('leads with Vendor recruitment as the primary call to action', () => {
    expect(preLaunchSource).toContain("t('vendorCta')")
    expect(preLaunchSource).toContain('/vendor/onboarding')
    const vendorIdx = preLaunchSource.indexOf("t('vendorHeading')")
    const blogIdx = preLaunchSource.indexOf("t('blogHeading')")
    expect(vendorIdx).toBeGreaterThan(-1)
    expect(blogIdx).toBeGreaterThan(-1)
    expect(vendorIdx).toBeLessThan(blogIdx)
  })

  it('renders the blog corpus', () => {
    expect(preLaunchSource).toContain('BlogPostCard')
    expect(preLaunchSource).toContain('/blog')
  })

  it('replaces the Experience rails with an honest launching-soon band', () => {
    expect(preLaunchSource).toContain("t('comingSoonHeading')")
    // No placeholder / skeleton / fake cards.
    expect(preLaunchSource).not.toMatch(/Skeleton|placeholder-card|animate-pulse/)
  })

  it('drops the hero search and destination tiles — both are dead pre-launch', () => {
    expect(preLaunchSource).not.toContain('HomeHeroSearch')
    expect(preLaunchSource).not.toContain('/search?region=')
    expect(preLaunchSource).not.toContain('getRegionImage')
    expect(preLaunchSource).not.toContain('ExperienceCard')
  })

  it('has exactly one <h1> and nests card headings below the section <h2>s', () => {
    const opens = preLaunchSource.match(/<h1[\s>]/g) ?? []
    expect(opens.length).toBe(1)
    expect(preLaunchSource).toContain('headingLevel="h3"')
  })

  it('sources every user-facing string from translation keys', () => {
    // Every rendered string goes through t(...); no bare English literals
    // in JSX text position.
    expect(preLaunchSource).toContain("namespace: 'HomePage.preLaunch'")
    const jsxText = preLaunchSource.match(/>\s*[A-Z][a-z]+ [a-z ]{6,}</g) ?? []
    expect(jsxText).toEqual([])
  })
})
