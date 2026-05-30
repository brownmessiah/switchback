import { Archive, CircleDot } from 'lucide-react'
import Link from 'next/link'

import { Badge } from '@/components/ui/badge'

interface ConversationRow {
  id: string
  customerUserId: string
  customerName: string | null
  subject: string
  status: string
  createdAt: Date
  updatedAt: Date
}

interface ConversationListProps {
  readonly conversations: ConversationRow[]
  /** The conversation currently open in the right pane (the `[id]` route). */
  readonly activeId?: string
}

function formatDate(date: Date): string {
  return new Date(date).toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
  })
}

// Conversation status → DESIGN.md §1.3 status Badge (color + icon, never color
// alone). Active threads are affirmative; archived ones are neutral/outline.
const STATUS_BADGE: Record<
  string,
  { variant: 'success' | 'outline'; label: string }
> = {
  active: { variant: 'success', label: 'Active' },
  archived: { variant: 'outline', label: 'Archived' },
}

/**
 * Left-pane conversation list for the variant B split-view (#55 B). Each row
 * is a `<Link>` to `/vendor/messages/[id]` so clicking navigates to the thread
 * route (preserves the E2E click→thread flow). The open conversation is
 * highlighted via `activeId`.
 */
export function ConversationList({
  conversations,
  activeId,
}: ConversationListProps) {
  return (
    <nav aria-label="Conversation list" className="flex flex-col">
      {conversations.map((conv) => {
        const status = STATUS_BADGE[conv.status] ?? STATUS_BADGE.archived
        const StatusIcon = conv.status === 'active' ? CircleDot : Archive
        const isActive = conv.id === activeId
        return (
          <Link
            key={conv.id}
            href={`/vendor/messages/${conv.id}`}
            aria-current={isActive ? 'true' : undefined}
            className={`flex flex-col gap-1 border-b border-border px-4 py-3 transition-colors hover:bg-muted/50 focus-visible:bg-muted/50 focus-visible:outline-none ${
              isActive ? 'bg-muted' : ''
            }`}
          >
            <div className="flex items-center justify-between gap-2">
              <p className="truncate text-sm font-medium">
                {conv.customerName ?? 'Customer'}
              </p>
              <span className="shrink-0 text-2xs text-muted-foreground tabular-nums">
                {formatDate(conv.updatedAt)}
              </span>
            </div>
            <p className="truncate text-xs text-muted-foreground">
              {conv.subject}
            </p>
            <Badge variant={status.variant} className="mt-0.5 text-2xs">
              <StatusIcon aria-hidden="true" />
              {status.label}
            </Badge>
          </Link>
        )
      })}
    </nav>
  )
}
