import { auditLogs } from '@/db/schema/audit-logs'
import type { DBOrTx } from '@/lib/payments/commission-resolver'

/**
 * Centralised append-only audit-log write helper.
 *
 * Every privileged or money-relevant action routes through this helper.
 * Accepts either the top-level db handle or a transaction handle so the
 * caller (typically booking-create or refund-flow) can write the audit
 * row inside the same db.transaction(...) as the business mutation —
 * the audit row rolls back atomically if the transaction aborts.
 *
 * Append-only convention is enforced by *not* exporting an update or
 * delete helper, plus the db/schema/audit-logs.ts comment. A future M3
 * structural enforcement (UPDATE-block trigger on audit_logs, similar
 * to the bookings snapshot lock) is on the M3 docket.
 */
export interface AuditWriteArgs {
  actorUserId: string | null
  action: string
  entityType: string
  entityId: string
  payload?: Record<string, unknown>
}

export async function writeAuditLog(db: DBOrTx, args: AuditWriteArgs): Promise<void> {
  if (!args.action) {
    throw new Error('action is required')
  }
  if (!args.entityType) {
    throw new Error('entityType is required')
  }
  if (!args.entityId) {
    throw new Error('entityId is required')
  }
  await db.insert(auditLogs).values({
    actorUserId: args.actorUserId,
    action: args.action,
    entityType: args.entityType,
    entityId: args.entityId,
    payload: args.payload ?? {},
  })
}
