'use client'

import { AlertCircle, Calendar } from 'lucide-react'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import type { ActionItem } from '@/lib/vendor/dashboard-loader'

interface ActionItemsProps {
  readonly items: readonly ActionItem[]
}

const iconMap = {
  unconfirmed_booking: AlertCircle,
  calendar_gap: Calendar,
} as const

export function ActionItems({ items }: ActionItemsProps) {
  if (items.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Action items</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="py-4 text-center text-sm text-muted-foreground">
            No pending actions. You are all caught up!
          </p>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Action items</CardTitle>
      </CardHeader>
      <CardContent>
        <ul className="space-y-3">
          {items.map((item) => {
            const Icon = iconMap[item.type]
            return (
              <li
                key={item.id}
                className="flex items-start gap-3 rounded-lg border p-3"
              >
                <div
                  className={`mt-0.5 rounded-full p-1.5 ${
                    item.type === 'unconfirmed_booking'
                      ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400'
                      : 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400'
                  }`}
                >
                  <Icon className="h-4 w-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">{item.title}</p>
                  <p className="text-xs text-muted-foreground">{item.subtitle}</p>
                </div>
              </li>
            )
          })}
        </ul>
      </CardContent>
    </Card>
  )
}
