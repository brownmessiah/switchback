'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'

import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { authClient } from '@/lib/auth/client'

interface UserMenuProps {
  user: { name: string; email: string; image?: string | null }
}

export function UserMenu({ user }: UserMenuProps) {
  const router = useRouter()

  const initials = user.name
    .split(' ')
    .map((n) => n[0])
    .join('')
    .slice(0, 2)
    .toUpperCase()

  async function handleSignOut() {
    await authClient.signOut()
    router.push('/')
    router.refresh()
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="rounded-full outline-none ring-ring focus-visible:ring-2">
        <Avatar className="h-8 w-8">
          {user.image && <AvatarImage src={user.image} alt={user.name} />}
          <AvatarFallback className="text-xs">{initials}</AvatarFallback>
        </Avatar>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel>
          <p className="text-sm font-medium">{user.name}</p>
          <p className="text-xs text-muted-foreground">{user.email}</p>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem>
          <Link href="/dashboard" className="w-full">My bookings</Link>
        </DropdownMenuItem>
        <DropdownMenuItem>
          <Link href="/community" className="w-full">Community</Link>
        </DropdownMenuItem>
        <DropdownMenuItem>
          <Link href="/support" className="w-full">Support</Link>
        </DropdownMenuItem>
        <DropdownMenuItem>
          <Link href="/settings" className="w-full">Account settings</Link>
        </DropdownMenuItem>
        <DropdownMenuItem>
          <Link href="/vendor/dashboard" className="w-full">Vendor dashboard</Link>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={handleSignOut}>
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
