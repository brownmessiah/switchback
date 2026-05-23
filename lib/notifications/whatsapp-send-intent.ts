import { writeAuditLog } from '@/lib/audit/write'
import type { DBOrTx } from '@/lib/payments/commission-resolver'

export interface WhatsAppSendIntentArgs {
  bookingId: string
  recipientPhone: string
  templateName: string
  templateBody: string
}

export async function writeWhatsAppSendIntent(
  db: DBOrTx,
  args: WhatsAppSendIntentArgs,
): Promise<void> {
  await writeAuditLog(db, {
    actorUserId: null,
    action: 'notification.whatsapp.intent',
    entityType: 'booking',
    entityId: args.bookingId,
    payload: {
      recipientPhone: args.recipientPhone,
      templateName: args.templateName,
      templateBody: args.templateBody,
    },
  })
}
