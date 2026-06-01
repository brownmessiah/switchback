import { describe, expect, it } from 'vitest'

import {
  canAdvanceToPlanning,
  canTransitionGroup,
  isArchivableAfterCompletion,
  isStaleForming,
  isTerminalGroupState,
  MIN_MEMBERS_TO_PLAN,
  POST_COMPLETED_ARCHIVE_DAYS,
  STALE_FORMING_DAYS,
  TRIP_GROUP_STATES,
  TRIP_GROUP_TRANSITIONS,
} from './group-lifecycle'

const DAY_MS = 24 * 60 * 60 * 1000

describe('trip-group lifecycle (ADR-0009)', () => {
  it('enumerates the six states', () => {
    expect([...TRIP_GROUP_STATES].sort()).toEqual(
      ['archived', 'booking', 'completed', 'forming', 'planning', 'traveling'].sort(),
    )
  })

  it('follows the ADR-0009 happy path forming→planning→booking→traveling→completed→archived', () => {
    expect(canTransitionGroup('forming', 'planning')).toBe(true)
    expect(canTransitionGroup('planning', 'booking')).toBe(true)
    expect(canTransitionGroup('booking', 'traveling')).toBe(true)
    expect(canTransitionGroup('traveling', 'completed')).toBe(true)
    expect(canTransitionGroup('completed', 'archived')).toBe(true)
  })

  it('allows archiving from any non-terminal state', () => {
    for (const s of ['forming', 'planning', 'booking', 'traveling', 'completed'] as const) {
      expect(canTransitionGroup(s, 'archived')).toBe(true)
    }
  })

  it('rejects skips and backwards moves', () => {
    expect(canTransitionGroup('forming', 'booking')).toBe(false)
    expect(canTransitionGroup('planning', 'forming')).toBe(false)
    expect(canTransitionGroup('completed', 'traveling')).toBe(false)
    expect(canTransitionGroup('archived', 'planning')).toBe(false)
  })

  it('archived is terminal', () => {
    expect(isTerminalGroupState('archived')).toBe(true)
    expect(TRIP_GROUP_TRANSITIONS.archived).toEqual([])
    for (const s of ['forming', 'planning', 'booking', 'traveling', 'completed'] as const) {
      expect(isTerminalGroupState(s)).toBe(false)
    }
  })

  it('gates forming→planning on the minimum active member count', () => {
    expect(MIN_MEMBERS_TO_PLAN).toBe(2)
    expect(canAdvanceToPlanning(1)).toBe(false)
    expect(canAdvanceToPlanning(2)).toBe(true)
    expect(canAdvanceToPlanning(5)).toBe(true)
  })

  it('flags a forming group stale after 30 days (auto-archive)', () => {
    const now = new Date('2026-07-01T00:00:00Z')
    const fresh = new Date(now.getTime() - 10 * DAY_MS)
    const stale = new Date(now.getTime() - (STALE_FORMING_DAYS + 1) * DAY_MS)
    expect(STALE_FORMING_DAYS).toBe(30)
    expect(isStaleForming('forming', fresh, now)).toBe(false)
    expect(isStaleForming('forming', stale, now)).toBe(true)
    // Only applies to forming groups.
    expect(isStaleForming('planning', stale, now)).toBe(false)
  })

  it('flags a completed group archivable after 60 days', () => {
    const now = new Date('2026-09-01T00:00:00Z')
    const recent = new Date(now.getTime() - 10 * DAY_MS)
    const old = new Date(now.getTime() - (POST_COMPLETED_ARCHIVE_DAYS + 1) * DAY_MS)
    expect(POST_COMPLETED_ARCHIVE_DAYS).toBe(60)
    expect(isArchivableAfterCompletion('completed', recent, now)).toBe(false)
    expect(isArchivableAfterCompletion('completed', old, now)).toBe(true)
    expect(isArchivableAfterCompletion('traveling', old, now)).toBe(false)
  })
})
