import { sql } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { customerProfiles } from '@/db/schema/customer-profiles'
import { users } from '@/db/schema/users'
import { setupTestDb, type TestDB } from '@/tests/helpers/db'

import { listPublicGroups } from './discovery'
import { createTripGroup } from './groups'

describe('trip-group discovery (/community, ADR-0009)', () => {
  let db: TestDB
  let teardown: () => Promise<void>

  beforeAll(async () => {
    const setup = await setupTestDb()
    db = setup.db
    teardown = setup.teardown
    await db.insert(users).values([
      { id: 'u_fhost', email: 'fh@t.com', name: 'FHost' },
      { id: 'u_mhost', email: 'mh@t.com', name: 'MHost' },
    ])
    await db.insert(customerProfiles).values([
      { userId: 'u_fhost', aadhaarGenderVerified: 'female' },
      { userId: 'u_mhost', aadhaarGenderVerified: 'male' },
    ])
  })

  afterAll(async () => {
    await teardown()
  })

  beforeEach(async () => {
    await db.execute(sql`TRUNCATE TABLE trip_group_members, trip_groups CASCADE`)
  })

  it('lists public + joinable groups, excluding private ones', async () => {
    await createTripGroup(db, { hostUserId: 'u_mhost', name: 'Public', maxMembers: 6, destinationSlugs: ['goa'] })
    await createTripGroup(db, { hostUserId: 'u_mhost', name: 'Private', maxMembers: 6, visibility: 'private' })
    const list = await listPublicGroups(db)
    const names = list.map((g) => g.name)
    expect(names).toContain('Public')
    expect(names).not.toContain('Private')
  })

  it('reports the active member count (host seeded as active)', async () => {
    await createTripGroup(db, { hostUserId: 'u_mhost', name: 'Solo', maxMembers: 6 })
    const [card] = await listPublicGroups(db)
    expect(card?.activeMemberCount).toBe(1)
  })

  it('filters by destination + interest tag', async () => {
    await createTripGroup(db, {
      hostUserId: 'u_mhost',
      name: 'Goa Rafting',
      maxMembers: 6,
      destinationSlugs: ['goa'],
      interestTags: ['rafting'],
    })
    await createTripGroup(db, {
      hostUserId: 'u_mhost',
      name: 'Manali Trek',
      maxMembers: 6,
      destinationSlugs: ['manali'],
      interestTags: ['trekking'],
    })
    expect((await listPublicGroups(db, { destinationSlug: 'goa' })).map((g) => g.name)).toEqual([
      'Goa Rafting',
    ])
    expect((await listPublicGroups(db, { interestTag: 'trekking' })).map((g) => g.name)).toEqual([
      'Manali Trek',
    ])
  })

  it('women-verified-hosts filter surfaces only female-hosted groups', async () => {
    await createTripGroup(db, { hostUserId: 'u_fhost', name: 'Female-hosted', maxMembers: 6 })
    await createTripGroup(db, { hostUserId: 'u_mhost', name: 'Male-hosted', maxMembers: 6 })
    const list = await listPublicGroups(db, { womenVerifiedHostsOnly: true })
    expect(list.map((g) => g.name)).toEqual(['Female-hosted'])
  })

  it('PRIVACY: discovery output never leaks host gender', async () => {
    await createTripGroup(db, { hostUserId: 'u_fhost', name: 'WO', maxMembers: 6, visibility: 'public_women_only' })
    const [card] = await listPublicGroups(db)
    const keys = Object.keys(card ?? {})
    expect(keys).not.toContain('gender')
    expect(keys).not.toContain('aadhaarGenderVerified')
    expect(keys.some((k) => /gender|aadhaar/i.test(k))).toBe(false)
  })

  it('shows public_women_only groups in discovery (joinable gate is separate)', async () => {
    await createTripGroup(db, { hostUserId: 'u_fhost', name: 'WomenOnly', maxMembers: 6, visibility: 'public_women_only' })
    expect((await listPublicGroups(db)).map((g) => g.name)).toContain('WomenOnly')
  })
})
