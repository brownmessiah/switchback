import { timingSafeEqual } from 'node:crypto'

import { headers } from 'next/headers'
import { NextResponse } from 'next/server'

import { db } from '@/db/client'
import { env } from '@/lib/env'
import { sweepAutoArchive } from '@/lib/trip-groups/group-transitions'

function safeCompare(a: string, b: string): boolean {
  const aBuf = Buffer.from(a)
  const bBuf = Buffer.from(b)
  if (aBuf.length !== bBuf.length) return false
  return timingSafeEqual(aBuf, bBuf)
}

/**
 * Vercel Cron entry — TripGroup auto-archive (ADR-0009): archives groups stuck
 * in `forming` ≥30 days and `completed` ≥60 days, keeping the discovery
 * surface fresh. Authenticated via CRON_SECRET like the other crons. Logic
 * lives in lib/trip-groups/group-transitions.ts (PGlite-testable).
 */
export async function POST(): Promise<NextResponse> {
  const secret = env.CRON_SECRET
  if (!secret) {
    return NextResponse.json({ error: 'CRON_SECRET not configured' }, { status: 500 })
  }

  const hdrs = await headers()
  const authHeader = hdrs.get('authorization') ?? ''
  if (!safeCompare(authHeader, `Bearer ${secret}`)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  try {
    const archived = await sweepAutoArchive(db, new Date())
    return NextResponse.json({ archived }, { status: 200 })
  } catch {
    return NextResponse.json({ error: 'internal error' }, { status: 500 })
  }
}
