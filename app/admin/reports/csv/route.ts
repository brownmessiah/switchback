import { eq } from 'drizzle-orm'
import { headers } from 'next/headers'
import { type NextRequest, NextResponse } from 'next/server'

import { db } from '@/db/client'
import { adminProfiles } from '@/db/schema'
import { auth } from '@/lib/auth'

import {
  loadBookingsForCsv,
  loadExperiencesForCsv,
  loadUsersForCsv,
  loadVendorsForCsv,
  toCsv,
} from '../loaders'

const ALLOWED_ENTITIES = ['users', 'vendors', 'bookings', 'experiences'] as const
type Entity = (typeof ALLOWED_ENTITIES)[number]

/**
 * GET /admin/reports/csv?entity=users|vendors|bookings|experiences
 *
 * Streams a CSV file for the requested entity. Requires 'reports'
 * permission in admin_profiles.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  // Auth check
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const [admin] = await db
    .select({ permissions: adminProfiles.permissions })
    .from(adminProfiles)
    .where(eq(adminProfiles.userId, session.user.id))
    .limit(1)

  if (!admin || !admin.permissions.includes('reports')) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  // Validate entity param
  const entity = request.nextUrl.searchParams.get('entity') as Entity | null
  if (!entity || !ALLOWED_ENTITIES.includes(entity)) {
    return NextResponse.json(
      { error: `Invalid entity. Allowed: ${ALLOWED_ENTITIES.join(', ')}` },
      { status: 400 },
    )
  }

  try {
    const csv = await buildCsv(entity)
    return new NextResponse(csv, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${entity}-${new Date().toISOString().slice(0, 10)}.csv"`,
      },
    })
  } catch {
    return NextResponse.json({ error: 'internal error' }, { status: 500 })
  }
}

async function buildCsv(entity: Entity): Promise<string> {
  switch (entity) {
    case 'users': {
      const rows = await loadUsersForCsv(db)
      return toCsv(rows, ['id', 'name', 'email', 'phoneNumber', 'emailVerified', 'createdAt'])
    }
    case 'vendors': {
      const rows = await loadVendorsForCsv(db)
      return toCsv(rows, [
        'userId',
        'businessName',
        'slug',
        'kycTier',
        'commissionRate',
        'suspended',
        'createdAt',
      ])
    }
    case 'bookings': {
      const rows = await loadBookingsForCsv(db)
      return toCsv(rows, [
        'id',
        'state',
        'participantCount',
        'grossTotalSnapshot',
        'paymentMode',
        'commissionRateSnapshot',
        'customerEmail',
        'experienceTitle',
        'vendorBusinessName',
        'confirmedAt',
      ])
    }
    case 'experiences': {
      const rows = await loadExperiencesForCsv(db)
      return toCsv(rows, [
        'id',
        'title',
        'slug',
        'status',
        'regionSlug',
        'activitySlug',
        'vendorBusinessName',
        'pricePerPerson_1_2',
        'cancellationPreset',
        'createdAt',
      ])
    }
  }
}
