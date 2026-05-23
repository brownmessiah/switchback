'use server'

import { headers } from 'next/headers'

import { db } from '@/db/client'
import { auth } from '@/lib/auth'
import { writeAuditLog } from '@/lib/audit/write'

export async function writeAbandonmentAudit(bookingId: string): Promise<void> {
  const session = await auth.api.getSession({ headers: await headers() })
  await writeAuditLog(db, {
    actorUserId: session?.user?.id ?? null,
    action: 'booking.payment_abandoned',
    entityType: 'booking',
    entityId: bookingId,
    payload: { source: 'razorpay_modal_dismiss' },
  })
}
