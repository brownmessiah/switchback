'use client'

import Link from 'next/link'
import { useTranslations } from 'next-intl'
import { useEffect, useState } from 'react'

import { NotificationBell } from './notification-bell'
import { UserMenu } from './user-menu'
import { authClient } from '@/lib/auth/client'

interface UserData {
  id: string
  name: string
  email: string
  image?: string | null
}

export interface UserRole {
  isAdmin: boolean
  isVendor: boolean
}

export function AuthStatus() {
  const [user, setUser] = useState<UserData | null>(null)
  const [role, setRole] = useState<UserRole>({ isAdmin: false, isVendor: false })
  const [loading, setLoading] = useState(true)
  const t = useTranslations('Nav')

  useEffect(() => {
    authClient.getSession().then((res) => {
      if (res.data?.user) {
        setUser({
          id: res.data.user.id,
          name: res.data.user.name ?? res.data.user.email ?? 'User',
          email: res.data.user.email ?? '',
          image: res.data.user.image ?? null,
        })
        // Resolve marketplace role (ADR-0006: from profile tables, not the
        // better-auth user) so the account menu links to the RIGHT dashboard.
        fetch('/api/me/role')
          .then((r) => r.json())
          .then((data: UserRole) => setRole(data))
          .catch(() => {})
      }
      setLoading(false)
    }).catch(() => {
      setLoading(false)
    })
  }, [])

  if (loading) {
    return <div className="h-8 w-8 animate-pulse rounded-full bg-muted" />
  }

  if (user) {
    return (
      <div className="flex items-center gap-2">
        <NotificationBell userId={user.id} />
        <UserMenu user={user} role={role} />
      </div>
    )
  }

  return (
    <Link
      href="/sign-in"
      className="rounded-full bg-primary px-4 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90"
    >
      {t('signIn')}
    </Link>
  )
}
