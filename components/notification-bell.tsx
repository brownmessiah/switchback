'use client'

import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  getRecentNotifications,
  markAllNotificationsRead,
  markNotificationRead,
} from '@/lib/notifications/actions'

interface NotificationItem {
  id: string
  type: string
  title: string
  body: string
  link: string | null
  readAt: Date | null
  createdAt: Date
}

interface NotificationBellProps {
  readonly userId: string
}

function BellIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
      <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
    </svg>
  )
}

function timeAgo(date: Date): string {
  const now = new Date()
  const diffMs = now.getTime() - new Date(date).getTime()
  const diffMins = Math.floor(diffMs / 60_000)
  if (diffMins < 1) return 'just now'
  if (diffMins < 60) return `${diffMins}m ago`
  const diffHours = Math.floor(diffMins / 60)
  if (diffHours < 24) return `${diffHours}h ago`
  const diffDays = Math.floor(diffHours / 24)
  return `${diffDays}d ago`
}

export function NotificationBell({ userId }: NotificationBellProps) {
  const [items, setItems] = useState<NotificationItem[]>([])
  const [unreadCount, setUnreadCount] = useState(0)
  const [loading, setLoading] = useState(true)

  const loadNotifications = useCallback(async () => {
    try {
      const data = await getRecentNotifications(userId, 10)
      setItems(data.notifications)
      setUnreadCount(data.unreadCount)
    } finally {
      setLoading(false)
    }
  }, [userId])

  useEffect(() => {
    loadNotifications()
  }, [loadNotifications])

  async function handleMarkRead(notificationId: string) {
    await markNotificationRead(notificationId, userId)
    setItems((prev) =>
      prev.map((item) =>
        item.id === notificationId
          ? { ...item, readAt: new Date() }
          : item,
      ),
    )
    setUnreadCount((c) => Math.max(0, c - 1))
  }

  async function handleMarkAllRead() {
    await markAllNotificationsRead(userId)
    setItems((prev) => prev.map((item) => ({ ...item, readAt: new Date() })))
    setUnreadCount(0)
  }

  if (loading) {
    return <div className="h-8 w-8 animate-pulse rounded-full bg-muted" />
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className="relative inline-flex items-center justify-center rounded-full p-1.5 text-muted-foreground outline-none ring-ring hover:text-foreground focus-visible:ring-2"
        aria-label={`Notifications${unreadCount > 0 ? `, ${unreadCount} unread` : ''}`}
      >
        <BellIcon />
        {unreadCount > 0 && (
          <span
            className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-bold text-primary-foreground"
            aria-hidden="true"
          >
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" className="w-80 max-h-96 overflow-y-auto">
        <div className="flex items-center justify-between px-3 py-2">
          <DropdownMenuLabel className="p-0 text-sm font-semibold">
            Notifications
          </DropdownMenuLabel>
          {unreadCount > 0 && (
            <button
              type="button"
              onClick={handleMarkAllRead}
              className="text-xs text-primary hover:underline"
            >
              Mark all read
            </button>
          )}
        </div>
        <DropdownMenuSeparator />

        {items.length === 0 ? (
          <div className="px-3 py-6 text-center text-sm text-muted-foreground">
            No notifications yet
          </div>
        ) : (
          items.map((item) => (
            <DropdownMenuItem
              key={item.id}
              className="flex flex-col items-start gap-0.5 px-3 py-2"
              onClick={() => {
                if (!item.readAt) {
                  handleMarkRead(item.id)
                }
              }}
            >
              {item.link ? (
                <Link href={item.link} className="w-full">
                  <div className="flex items-start gap-2 w-full">
                    {!item.readAt && (
                      <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-primary" />
                    )}
                    <div className={`flex-1 ${item.readAt ? 'pl-4' : ''}`}>
                      <p className="text-sm font-medium leading-tight">
                        {item.title}
                      </p>
                      <p className="mt-0.5 text-xs text-muted-foreground line-clamp-2">
                        {item.body}
                      </p>
                      <p className="mt-1 text-[10px] text-muted-foreground/60">
                        {timeAgo(item.createdAt)}
                      </p>
                    </div>
                  </div>
                </Link>
              ) : (
                <div className="flex items-start gap-2 w-full">
                  {!item.readAt && (
                    <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-primary" />
                  )}
                  <div className={`flex-1 ${item.readAt ? 'pl-4' : ''}`}>
                    <p className="text-sm font-medium leading-tight">
                      {item.title}
                    </p>
                    <p className="mt-0.5 text-xs text-muted-foreground line-clamp-2">
                      {item.body}
                    </p>
                    <p className="mt-1 text-[10px] text-muted-foreground/60">
                      {timeAgo(item.createdAt)}
                    </p>
                  </div>
                </div>
              )}
            </DropdownMenuItem>
          ))
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
