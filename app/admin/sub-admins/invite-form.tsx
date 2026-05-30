'use client'

import { CheckCircle2Icon } from 'lucide-react'
import { useRef, useState, useTransition } from 'react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { ADMIN_PERMISSIONS } from '@/lib/auth/permissions'

import { inviteSubAdmin, type SubAdminActionResult } from './actions'

/** Human-readable labels for permissions */
const PERMISSION_LABELS: Record<string, string> = {
  overview: 'Dashboard Overview',
  analytics: 'Analytics',
  vendors: 'Vendor Management',
  experiences: 'Experience Moderation',
  bookings: 'Bookings',
  payouts: 'Payout Processing',
  refunds: 'Refund Processing',
  commission: 'Commission Tiers',
  region_closures: 'Region Closures',
  reviews: 'Review Moderation',
  support: 'Support Tickets',
  blog: 'Blog CMS',
  site_builder: 'Site Builder',
  audit: 'Audit Logs',
  sub_admins: 'Sub-Admin Management',
  reports: 'Reports',
}

export function InviteSubAdminForm() {
  const formRef = useRef<HTMLFormElement>(null)
  const [isPending, startTransition] = useTransition()
  const [result, setResult] = useState<SubAdminActionResult | null>(null)

  function handleSubmit(formData: FormData) {
    startTransition(async () => {
      const res = await inviteSubAdmin(formData)
      setResult(res)
      if (res.ok) {
        formRef.current?.reset()
      }
    })
  }

  return (
    <form ref={formRef} action={handleSubmit} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="invite-email">Email address</Label>
        <Input
          id="invite-email"
          name="email"
          type="email"
          placeholder="sub-admin@example.com"
          required
        />
        <p className="text-xs text-muted-foreground">
          If the user exists, they are granted admin access immediately (demo
          mode).
        </p>
      </div>

      <div className="space-y-2">
        <Label className="text-sm font-medium">
          Permission subset (select at least one)
        </Label>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {ADMIN_PERMISSIONS.map((perm) => (
            <label
              key={perm}
              className="flex cursor-pointer items-center gap-2 rounded-[var(--radius-control)] border px-3 py-2 text-sm hover:bg-muted/50"
            >
              <input
                type="checkbox"
                name={`perm_${perm}`}
                value="1"
                className="size-4 rounded border-input"
              />
              <span>{PERMISSION_LABELS[perm] ?? perm}</span>
            </label>
          ))}
        </div>
      </div>

      {result && !result.ok && (
        <p
          className="rounded-[var(--radius-control)] bg-destructive/10 px-3 py-2 text-sm text-destructive"
          role="alert"
        >
          {result.error}
        </p>
      )}
      {result?.ok && (
        <p
          className="flex items-center gap-1.5 rounded-[var(--radius-control)] bg-success-subtle px-3 py-2 text-sm text-success"
          role="status"
        >
          <CheckCircle2Icon className="size-4" aria-hidden />
          Sub-admin access granted.
        </p>
      )}

      <Button type="submit" disabled={isPending}>
        {isPending ? 'Creating…' : 'Grant Admin Access'}
      </Button>
    </form>
  )
}
