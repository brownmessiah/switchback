import { eq } from 'drizzle-orm'
import { headers } from 'next/headers'
import Link from 'next/link'
import { notFound } from 'next/navigation'

import { db } from '@/db/client'
import { availabilitySlots } from '@/db/schema/availability-slots'
import { bookings } from '@/db/schema/bookings'
import { conversations } from '@/db/schema/conversations'
import { experiences } from '@/db/schema/experiences'
import { auth } from '@/lib/auth'
import {
  getConversationMessages,
  getVendorConversations,
  markConversationMessagesRead,
} from '@/lib/notifications/messaging-actions'

import { ConversationList } from '../conversation-list'
import { SplitView } from '../split-view'
import { MessageThread, type BookingContext } from './message-thread'

interface PageProps {
  params: Promise<{ id: string }>
}

/**
 * Read-only Booking context for the pinned thread header (fold C). Re-fetches
 * the conversation row's `bookingId` (NOT exposed by getConversationMessages,
 * which we must not change) and, when set, joins the Booking → Experience →
 * Slot for display. Returns null when the Conversation is not Booking-tied —
 * the header is then omitted (no fabrication).
 */
async function loadBookingContext(
  conversationId: string,
): Promise<BookingContext | null> {
  const [conv] = await db
    .select({ bookingId: conversations.bookingId })
    .from(conversations)
    .where(eq(conversations.id, conversationId))
    .limit(1)

  if (!conv?.bookingId) {
    return null
  }

  const [row] = await db
    .select({
      participantCount: bookings.participantCount,
      paymentMode: bookings.paymentMode,
      cancellationPreset: bookings.cancellationPresetSnapshot,
      grossTotal: bookings.grossTotalSnapshot,
      experienceTitle: experiences.title,
      experienceSlug: experiences.slug,
      slotStart: availabilitySlots.startAt,
      slotEnd: availabilitySlots.endAt,
    })
    .from(bookings)
    .innerJoin(experiences, eq(bookings.experienceId, experiences.id))
    .leftJoin(availabilitySlots, eq(bookings.slotId, availabilitySlots.id))
    .where(eq(bookings.id, conv.bookingId))
    .limit(1)

  if (!row) {
    return null
  }

  return {
    experienceTitle: row.experienceTitle,
    experienceSlug: row.experienceSlug,
    participantCount: row.participantCount,
    paymentMode: row.paymentMode,
    cancellationPreset: row.cancellationPreset,
    grossTotalRupees: Math.floor(Number(row.grossTotal)),
    slotStart: row.slotStart ? row.slotStart.toISOString() : null,
    slotEnd: row.slotEnd ? row.slotEnd.toISOString() : null,
  }
}

export default async function VendorMessageThreadPage({ params }: PageProps) {
  const { id } = await params
  const session = await auth.api.getSession({ headers: await headers() })
  const userId = session!.user.id

  const data = await getConversationMessages(id)
  if (!data) {
    notFound()
  }

  // Mark unread messages as read (messages sent by the other party).
  await markConversationMessagesRead(id, userId)

  // Left pane: the same inbox list the `/vendor/messages` route renders.
  const conversations = await getVendorConversations(userId)
  // Right-pane Booking context header (omitted when not Booking-tied).
  const bookingContext = await loadBookingContext(id)

  // First-response SLA, derived purely from the messages already loaded
  // (conversation createdAt vs the vendor's first reply — the schema's
  // documented SLA basis). No extra query, no action change. Omitted when
  // the vendor has not yet replied.
  const vendorFirstReply = data.messages.find(
    (m) => m.senderUserId === data.conversation.vendorUserId,
  )
  const firstResponseMs = vendorFirstReply
    ? new Date(vendorFirstReply.createdAt).getTime() -
      new Date(data.conversation.createdAt).getTime()
    : null

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-semibold tracking-tight">
          Messages
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Communicate with customers about their bookings.
        </p>
      </div>

      <SplitView
        selected
        list={<ConversationList conversations={conversations} activeId={id} />}
        detail={
          <div className="flex min-h-0 flex-1 flex-col">
            {/* Narrow-viewport back link (hidden on lg — the list is visible). */}
            <Link
              href="/vendor/messages"
              className="flex items-center gap-1 border-b border-border px-4 py-3 text-sm text-muted-foreground hover:text-foreground lg:hidden"
              aria-label="Back to conversations"
            >
              &larr; Back
            </Link>
            <MessageThread
              conversationId={id}
              currentUserId={userId}
              subject={data.conversation.subject}
              conversationCreatedAt={data.conversation.createdAt}
              firstResponseMs={firstResponseMs}
              bookingContext={bookingContext}
              initialMessages={data.messages}
            />
          </div>
        }
      />
    </div>
  )
}
