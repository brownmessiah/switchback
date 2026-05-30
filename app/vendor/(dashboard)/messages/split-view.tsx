import type { ReactNode } from 'react'

interface SplitViewProps {
  /** Left pane — the conversation list. */
  readonly list: ReactNode
  /** Right pane — the thread, or a "select a conversation" placeholder. */
  readonly detail: ReactNode
  /**
   * Whether a conversation is currently selected (the `[id]` route).
   * Drives the narrow-viewport degrade (DESIGN.md §4 split-view pattern):
   *   - no selection  → narrow shows the LIST only (right pane hidden < lg)
   *   - selection set → narrow shows the THREAD only (left pane hidden < lg)
   * On `lg` and up BOTH panes are always co-present (helpdesk layout).
   */
  readonly selected: boolean
}

/**
 * Variant B "Split-View Conversation" shell (#55 direction B). A two-pane
 * helpdesk layout — conversation LIST on the left, THREAD on the right — shared
 * verbatim by both `/vendor/messages` (no selection) and
 * `/vendor/messages/[id]` (pre-selected). On narrow viewports it degrades to
 * variant A's single pane: list-only on the inbox, thread-only on the thread
 * route. Both panes carry a stable `data-testid` so the split layout is
 * assertable.
 */
export function SplitView({ list, detail, selected }: SplitViewProps) {
  return (
    <div className="grid h-[calc(100vh-var(--header-offset,4rem)-6rem)] min-h-[28rem] grid-cols-1 gap-px overflow-hidden rounded-[var(--radius-card)] border border-border bg-border lg:grid-cols-[20rem_1fr]">
      {/* ── Left: conversation list ───────────────────────────────────── */}
      <aside
        data-testid="messages-list-pane"
        aria-label="Conversations"
        className={`min-h-0 flex-col overflow-y-auto bg-surface-1 ${
          selected ? 'hidden lg:flex' : 'flex'
        }`}
      >
        {list}
      </aside>

      {/* ── Right: thread / placeholder ───────────────────────────────── */}
      <section
        data-testid="messages-thread-pane"
        aria-label="Conversation"
        className={`min-h-0 flex-col overflow-hidden bg-surface-1 ${
          selected ? 'flex' : 'hidden lg:flex'
        }`}
      >
        {detail}
      </section>
    </div>
  )
}
