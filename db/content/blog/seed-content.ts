/**
 * Standalone, production-safe seeder for the editorial blog corpus. Runs the
 * idempotent upsert against the configured database independently of the demo
 * seed (which wipes/rebuilds fixtures). Self-provisions the editorial author.
 *
 *   pnpm db:seed:blog
 */
import { db } from '@/db/client'

import { upsertBlogPosts } from './upsert'

upsertBlogPosts(db)
  .then(({ count }) => {
    console.warn(`upserted ${count} editorial blog posts`)
    process.exit(0)
  })
  .catch((err: unknown) => {
    console.error('blog content seed failed:', err)
    process.exit(1)
  })
