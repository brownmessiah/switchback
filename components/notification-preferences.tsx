'use client'

import { useTranslations } from 'next-intl'
import { useCallback, useEffect, useState } from 'react'

import {
  getNotificationPreferences,
  upsertNotificationPreference,
} from '@/lib/notifications/actions'
import { NOTIFICATION_CHANNELS, NOTIFICATION_TYPES } from '@/lib/notifications/types'

interface NotificationPreferencesProps {
  readonly userId: string
}

/**
 * Preference state: a nested map of eventType -> channel -> enabled.
 * Missing entries are treated as enabled (opt-out model).
 */
type PreferenceState = Record<string, Record<string, boolean>>

export function NotificationPreferences({ userId }: NotificationPreferencesProps) {
  const t = useTranslations('SettingsPage.notifications')
  const [prefs, setPrefs] = useState<PreferenceState>({})
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState<string | null>(null)

  const loadPrefs = useCallback(async () => {
    try {
      const rows = await getNotificationPreferences(userId)
      const state: PreferenceState = {}
      for (const row of rows) {
        if (!state[row.eventType]) {
          state[row.eventType] = {}
        }
        state[row.eventType]![row.channel] = row.enabled
      }
      setPrefs(state)
    } finally {
      setLoading(false)
    }
  }, [userId])

  useEffect(() => {
    loadPrefs()
  }, [loadPrefs])

  function isEnabled(eventType: string, channel: string): boolean {
    return prefs[eventType]?.[channel] ?? true // default enabled (opt-out)
  }

  async function handleToggle(eventType: string, channel: string) {
    const currentlyEnabled = isEnabled(eventType, channel)
    const newValue = !currentlyEnabled
    const key = `${eventType}:${channel}`

    // Optimistic update
    setPrefs((prev) => ({
      ...prev,
      [eventType]: {
        ...prev[eventType],
        [channel]: newValue,
      },
    }))

    setSaving(key)
    try {
      await upsertNotificationPreference(userId, eventType, channel, newValue)
    } catch {
      // Revert on failure
      setPrefs((prev) => ({
        ...prev,
        [eventType]: {
          ...prev[eventType],
          [channel]: currentlyEnabled,
        },
      }))
    } finally {
      setSaving(null)
    }
  }

  if (loading) {
    return (
      <div className="space-y-4">
        {[1, 2, 3].map((i) => (
          <div key={i} className="h-12 animate-pulse rounded bg-muted" />
        ))}
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold">{t('heading')}</h2>
        <p className="mt-1 text-sm text-muted-foreground">{t('description')}</p>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm" role="grid" aria-label={t('heading')}>
          <thead>
            <tr className="border-b">
              <th className="py-3 pr-4 text-left font-medium">{t('event')}</th>
              {NOTIFICATION_CHANNELS.map((ch) => (
                <th key={ch} className="px-4 py-3 text-center font-medium">
                  {t(`channels.${ch}`)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {NOTIFICATION_TYPES.map((eventType) => (
              <tr key={eventType} className="border-b last:border-0">
                <td className="py-3 pr-4 font-medium">{t(`events.${eventType}`)}</td>
                {NOTIFICATION_CHANNELS.map((channel) => {
                  const enabled = isEnabled(eventType, channel)
                  const key = `${eventType}:${channel}`
                  const isSaving = saving === key
                  return (
                    <td key={channel} className="px-4 py-3 text-center">
                      <button
                        type="button"
                        role="switch"
                        data-testid={`notif-toggle-${eventType}-${channel}`}
                        aria-checked={enabled}
                        aria-label={`${t(`events.${eventType}`)} — ${t(`channels.${channel}`)}`}
                        disabled={isSaving}
                        onClick={() => handleToggle(eventType, channel)}
                        className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 ${
                          enabled ? 'bg-primary' : 'bg-muted'
                        }`}
                      >
                        <span
                          className={`pointer-events-none inline-block h-5 w-5 rounded-full bg-background shadow-lg ring-0 transition-transform ${
                            enabled ? 'translate-x-5' : 'translate-x-0'
                          }`}
                        />
                      </button>
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
