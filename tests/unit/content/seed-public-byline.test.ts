import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

/**
 * QA fix pass: public blog articles rendered "By Seed Admin" — the seeded
 * admin user's display name leaks straight into the public byline because
 * blog_posts.author_admin_id → users.name is the byline source and the
 * column is NOT NULL. The seed must therefore give the authoring user a
 * public-grade editorial name. Same source-guard pattern as
 * credibility-copy.test.ts.
 */
describe('seed data — public byline hygiene', () => {
  const root = process.cwd()

  it.each(['db/seed.ts', 'db/seed-extras.ts'])(
    '%s never names a user "Seed Admin"',
    (file) => {
      const source = readFileSync(join(root, file), 'utf8')
      expect(source).not.toContain('Seed Admin')
    },
  )

  it('db/seed.ts names the blog-authoring admin "Switchback Editorial Team"', () => {
    const source = readFileSync(join(root, 'db/seed.ts'), 'utf8')
    expect(source).toContain('Switchback Editorial Team')
  })
})
