import { describe, expect, it } from 'vitest'

import {
  NEVER_PURGE_TABLES,
  SEED_ADMIN_USER_ID,
  SEED_EMAIL_DOMAIN,
  SEED_MEDIA_KEY_PREFIX,
  SEED_USER_ID_PREFIXES,
  SEEDED_COMMISSION_TIER_NAMES,
  SEEDED_PRICING_TIER_NAMES,
  SEEDED_PROMO_CODES,
  SEEDED_REGION_CLOSURE_REGIONS,
  isSeedEmail,
  isSeedMediaStorageKey,
  isSeedUserId,
} from './seed-data-registry'

/**
 * Single source of truth for "what is seed data" (launch-readiness 05).
 *
 * The PRD claimed seeded Users carry BOTH an @seed.outvers.dev email and
 * a `u_seed_` id prefix. Only the email holds: five distinct prefixes
 * exist across the seed modules, and `u_seed_` matches roughly a third
 * of them. A registry keyed on the prefix would silently leave ~99
 * seeded Users — and every Experience, Booking and wallet row hanging
 * off them — alive on production, while the dry-run counts looked
 * plausible. The email domain is therefore the PRIMARY predicate and the
 * prefixes are a documented SET used only as corroboration.
 */
describe('seed email predicate (the primary identifier)', () => {
  it.each([
    'admin@seed.outvers.dev',
    'phone-tier@seed.outvers.dev',
    'business-tier@seed.outvers.dev',
    'subadmin-vendor@seed.outvers.dev',
  ])('classifies %s as seed', (email) => {
    expect(isSeedEmail(email)).toBe(true)
  })

  it('is case-insensitive (better-auth lowercases, raw inserts may not)', () => {
    expect(isSeedEmail('Admin@Seed.Outvers.Dev')).toBe(true)
  })

  it.each([
    ['the real owner account', 'aishwarye@outvers.com'],
    ['the editorial blog author', 'editorial@outvers.com'],
    ['an ordinary customer', 'someone@gmail.com'],
    ['a lookalike parent domain', 'someone@outvers.dev'],
    ['a lookalike suffix', 'someone@notseed.outvers.dev.evil.com'],
    ['domain as a local part', 'seed.outvers.dev@gmail.com'],
  ])('does NOT classify %s as seed', (_label, email) => {
    expect(isSeedEmail(email)).toBe(false)
  })

  // users.email is nullable, and a phone-only User has no email at all.
  it.each([
    ['null', null],
    ['undefined', undefined],
    ['empty string', ''],
    ['non-string', 42],
  ])('treats %s as NOT seed (fail safe — never delete what you cannot identify)', (_l, v) => {
    expect(isSeedEmail(v)).toBe(false)
  })

  // The phone-signup temp email minted in slice 03 must never fall under
  // the deletion predicate: a real user who signed up by phone would
  // otherwise be classified as seed data and purged.
  it('does NOT classify a phone-signup temp email as seed', () => {
    expect(isSeedEmail('919876543210@phone.outvers.com')).toBe(false)
  })
})

describe('seed user id prefixes (corroboration only)', () => {
  it('covers every prefix the seed modules actually mint', () => {
    expect([...SEED_USER_ID_PREFIXES].sort()).toEqual([
      'u_cat_',
      'u_demo_cust_',
      'u_enr_cust_',
      'u_seed_',
      'u_tg_',
    ])
  })

  it.each([
    ['base seed', 'u_seed_admin'],
    ['catalog vendor', 'u_cat_rishikesh_01'],
    ['enriched customer', 'u_enr_cust_03'],
    ['demo catalog customer', 'u_demo_cust_01'],
    ['trip group host', 'u_tg_host_a'],
  ])('recognises a %s id', (_label, id) => {
    expect(isSeedUserId(id)).toBe(true)
  })

  it.each([
    ['a real signup uuid', '9f1c2d3e-4a5b-6c7d-8e9f-0a1b2c3d4e5f'],
    ['the editorial author', 'u_content_editor'],
    ['a lookalike', 'user_seed_admin'],
  ])('does not recognise %s', (_label, id) => {
    expect(isSeedUserId(id)).toBe(false)
  })
})

describe('seed media storage keys', () => {
  it.each(['seed/base/rafting.jpg', 'seed/catalog/goa-01.jpg', 'seed/demo/x.jpg'])(
    'classifies %s as seed',
    (key) => {
      expect(isSeedMediaStorageKey(key)).toBe(true)
    },
  )

  // Real uploads own an object in the public GCS bucket. Deleting the row
  // without deleting the object orphans it forever, and a bucket delete
  // cannot be transactional with the purge — so real media is never seed.
  it.each([
    'experiences/9f1c2d3e/cover.jpg',
    'reviews/abc123/photo.jpg',
    'blog/post-1/hero.jpg',
  ])('does NOT classify real upload %s as seed', (key) => {
    expect(isSeedMediaStorageKey(key)).toBe(false)
  })

  it('does not match a key that merely contains "seed/" later on', () => {
    expect(isSeedMediaStorageKey('experiences/abc/seed/nope.jpg')).toBe(false)
  })

  it.each([null, undefined, ''])('treats %s as NOT seed', (v) => {
    expect(isSeedMediaStorageKey(v)).toBe(false)
  })
})

describe('content-keyed seed rows (unreachable by user traversal)', () => {
  // These tables have no FK to users at all, or a SET NULL edge, so
  // deleting every seeded User leaves them behind. Two are live hazards.
  it('lists the seeded promo codes — free wallet credit to anyone who knows them', () => {
    expect([...SEEDED_PROMO_CODES].sort()).toEqual([
      'DIWALI2026',
      'FIRSTBOOKING',
      'LADAKH2000',
      'MONSOON15',
      'REFER300',
      'SUMMER10',
      'WELCOME500',
    ])
  })

  it('lists the seeded region closures — they suppress slot materialisation', () => {
    expect([...SEEDED_REGION_CLOSURE_REGIONS].sort()).toEqual([
      'andaman',
      'auli',
      'leh-ladakh',
      'lonavala',
      'spiti',
    ])
  })

  it('lists the seeded commission and pricing tier names', () => {
    expect(SEEDED_COMMISSION_TIER_NAMES.length).toBeGreaterThan(0)
    expect(SEEDED_PRICING_TIER_NAMES.length).toBeGreaterThan(0)
  })
})

describe('never-purge tables', () => {
  it.each([
    ['blog_posts', 'the 40-post SEO corpus the purge exists to preserve'],
    ['audit_logs', 'an append-only trigger RAISEs on DELETE and aborts the transaction'],
    ['newsletter_subscribers', 'real captured emails, never written by any seeder'],
    ['schema_migrations', 'migration bookkeeping'],
    ['slug_redirects', 'live 301s for retired slugs'],
    ['ai_generations', 'never seeded; every row is a real ADR-0010 audit record'],
    ['site_content', 'purging it would blank the admin site-builder CMS'],
  ])('protects %s (%s)', (table) => {
    expect(NEVER_PURGE_TABLES).toContain(table)
  })
})

describe('seeded admin identity', () => {
  it('names the seeded admin user id that slice 07 converts in place', () => {
    expect(SEED_ADMIN_USER_ID).toBe('u_seed_admin')
    expect(isSeedUserId(SEED_ADMIN_USER_ID)).toBe(true)
  })

  it('exposes the domain as a constant rather than re-encoding it per consumer', () => {
    expect(SEED_EMAIL_DOMAIN).toBe('@seed.outvers.dev')
    expect(SEED_MEDIA_KEY_PREFIX).toBe('seed/')
  })
})
