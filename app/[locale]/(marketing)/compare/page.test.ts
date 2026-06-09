import { describe, expect, it, vi } from 'vitest'

// next-intl server translator: return the namespaced key so we can assert
// metadata is wired without loading real messages.
vi.mock('next-intl/server', () => ({
  getTranslations: async () => (key: string) => `Compare.${key}`,
  setRequestLocale: () => {},
}))

import { generateMetadata } from './page'

/**
 * `/compare` is NOINDEX (DECISION D10): it is a transient, per-visitor view of
 * an arbitrary localStorage selection — it must never be indexed or enter the
 * sitemap. The robots directive is emitted via the Metadata API so it lands in
 * <head> (an in-body <meta> is not hoisted reliably).
 */
describe('compare page metadata (noindex, D10)', () => {
  it('marks the page noindex', async () => {
    const meta = await generateMetadata({ params: Promise.resolve({ locale: 'en' }) })
    expect(meta.robots).toBeDefined()
    const robots = meta.robots as { index?: boolean; follow?: boolean }
    expect(robots.index).toBe(false)
  })

  it('still allows crawlers to follow links off the page', async () => {
    const meta = await generateMetadata({ params: Promise.resolve({ locale: 'en' }) })
    const robots = meta.robots as { index?: boolean; follow?: boolean }
    expect(robots.follow).toBe(true)
  })

  it('sets a title', async () => {
    const meta = await generateMetadata({ params: Promise.resolve({ locale: 'en' }) })
    expect(typeof meta.title).toBe('string')
    expect((meta.title as string).length).toBeGreaterThan(0)
  })
})
