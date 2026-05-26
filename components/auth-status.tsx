'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'

import { UserMenu } from './user-menu'
import { authClient } from '@/lib/auth/client'

interface AuthStatusProps {
  prefix: string
}

interface UserData {
  name: string
  email: string
  image?: string | null
}

export function AuthStatus({ prefix }: AuthStatusProps) {
  const [user, setUser] = useState<UserData | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    authClient.getSession().then((res) => {
      if (res.data?.user) {
        setUser({
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
    return <UserMenu user={user} prefix={prefix} />
  }

  return (
    <Link
      href={`${prefix}/sign-in`}
      className="rounded-full bg-primary px-4 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90"
    >
      Sign in
    </Link>
  )
}
