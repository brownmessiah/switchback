import postgres from 'postgres'

import { test, expect } from '../../fixtures/devtools'
import { e2eDbUrl } from '../../helpers/config'

/**
 * Public blog reader (parity-catchup/03). Self-seeds one published + one draft
 * post directly into the e2e DB (the core seed has no blog posts on this
 * branch), then asserts the index, the article render + Article JSON-LD, and
 * published/unpublished visibility. The DevTools fixture axe-gates every page.
 */

// Serial: the file shares one DB fixture (one published + one draft post), so
// run its tests in a single worker. Under fullyParallel, beforeAll would run in
// multiple workers concurrently and race on the unique blog slug.
test.describe.configure({ mode: 'serial' })

const PUBLISHED_SLUG = 'e2e-blog-published-fixture'
const DRAFT_SLUG = 'e2e-blog-draft-fixture'
const PUBLISHED_TITLE = 'E2E Published Blog Fixture'
const CONTENT = '## A Section Heading\n\nA paragraph of body copy.\n\n- First bullet\n- Second bullet'

async function withSql<T>(fn: (sql: postgres.Sql) => Promise<T>): Promise<T> {
  const sql = postgres(e2eDbUrl(), { max: 1 })
  try {
    return await fn(sql)
  } finally {
    await sql.end()
  }
}

test.beforeAll(async () => {
  await withSql(async (sql) => {
    await sql`DELETE FROM blog_posts WHERE slug IN (${PUBLISHED_SLUG}, ${DRAFT_SLUG})`
    await sql`
      INSERT INTO blog_posts (title, slug, content, excerpt, category, cover_image_url, status, published_at, author_admin_id)
      VALUES
        (${PUBLISHED_TITLE}, ${PUBLISHED_SLUG}, ${CONTENT}, 'A short excerpt.', 'guides',
         'https://images.unsplash.com/photo-1530866495561-507c9faab2ed?w=1200&q=80&auto=format&fit=crop',
         'published', now() - interval '1 day', 'u_seed_admin'),
        (${'E2E Draft Blog Fixture'}, ${DRAFT_SLUG}, ${'draft body'}, 'draft excerpt', 'tips',
         null, 'draft', null, 'u_seed_admin')
      ON CONFLICT (slug) DO NOTHING
    `
  })
})

test.afterAll(async () => {
  await withSql(async (sql) => {
    await sql`DELETE FROM blog_posts WHERE slug IN (${PUBLISHED_SLUG}, ${DRAFT_SLUG})`
  })
})

test.describe('Blog index (/blog)', () => {
  test('renders 200, breadcrumb, BreadcrumbList JSON-LD, and lists the published post (not the draft)', async ({
    page,
  }) => {
    const res = await page.goto('/blog')
    expect(res?.status()).toBe(200)

    await expect(page.locator('h1')).toBeVisible()
    await expect(page.locator('nav[aria-label="Breadcrumb"]')).toBeVisible()

    // BreadcrumbList JSON-LD present.
    const scripts = page.locator('script[type="application/ld+json"]')
    let foundBreadcrumb = false
    for (let i = 0; i < (await scripts.count()); i++) {
      const parsed = JSON.parse((await scripts.nth(i).textContent()) ?? '{}')
      if (parsed['@type'] === 'BreadcrumbList') foundBreadcrumb = true
    }
    expect(foundBreadcrumb).toBe(true)

    // The published post links out; the draft is absent.
    await expect(page.locator(`a[href$="/blog/${PUBLISHED_SLUG}"]`)).toHaveCount(1)
    await expect(page.locator(`a[href$="/blog/${DRAFT_SLUG}"]`)).toHaveCount(0)
  })
})

test.describe('Blog article (/blog/[slug])', () => {
  test('renders the published article with Article + BreadcrumbList JSON-LD and markdown body', async ({
    page,
  }) => {
    const res = await page.goto(`/blog/${PUBLISHED_SLUG}`)
    expect(res?.status()).toBe(200)

    await expect(page.locator('h1')).toContainText(PUBLISHED_TITLE)

    const scripts = page.locator('script[type="application/ld+json"]')
    let foundArticle = false
    let foundBreadcrumb = false
    for (let i = 0; i < (await scripts.count()); i++) {
      const parsed = JSON.parse((await scripts.nth(i).textContent()) ?? '{}')
      if (parsed['@type'] === 'Article') {
        foundArticle = true
        expect(parsed['@context']).toBe('https://schema.org')
        expect(parsed.headline).toBe(PUBLISHED_TITLE)
        expect(parsed.author?.name).toBeTruthy()
        expect(parsed.datePublished).toBeTruthy()
      }
      if (parsed['@type'] === 'BreadcrumbList') foundBreadcrumb = true
    }
    expect(foundArticle).toBe(true)
    expect(foundBreadcrumb).toBe(true)

    // Markdown body rendered: the `## ` heading + a list item became real DOM.
    await expect(page.getByRole('heading', { name: 'A Section Heading' })).toBeVisible()
    await expect(page.getByText('First bullet')).toBeVisible()
  })

  test('returns 404 for an unpublished (draft) post', async ({ page }) => {
    const res = await page.goto(`/blog/${DRAFT_SLUG}`)
    expect(res?.status()).toBe(404)
  })

  test('returns 404 for a missing slug', async ({ page }) => {
    const res = await page.goto('/blog/this-slug-does-not-exist-xyz')
    expect(res?.status()).toBe(404)
  })
})
