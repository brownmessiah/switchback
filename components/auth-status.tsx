'use client'

import Link from 'next/link'
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

export function AuthStatus() {
  const [user, setUser] = useState<UserData | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    authClient.getSession().then((res) => {
      if (res.data?.user) {
        setUser({
          id: res.data.user.id,
          name: res.data.user.name ?? res.data.user.email ?? 'User',
          email: res.data.user.email ?? '',
          image: res.data.user.image ?? null,
        })
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
        <UserMenu user={user} />
      </div>
    )
  }

  return (
    <Link
      href="/sign-in"
      className="rounded-full bg-primary px-4 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90"
    >
      Sign in
    </Link>
  )
}
