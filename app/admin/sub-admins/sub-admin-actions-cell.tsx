'use client'

import { useRef, useState, useTransition } from 'react'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { ADMIN_PERMISSIONS } from '@/lib/auth/permissions'

import {
  editSubAdminPermissions,
  revokeSubAdmin,
  type SubAdminActionResult,
} from './actions'

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

interface SubAdminActionsCellProps {
  userId: string
  email: string | null
  name: string | null
  permissions: string[]
}

export function SubAdminActionsCell({
  userId,
  email,
  name,
  permissions,
}: SubAdminActionsCellProps) {
  const [isPending, startTransition] = useTransition()
  const [editOpen, setEditOpen] = useState(false)
  const [editResult, setEditResult] = useState<SubAdminActionResult | null>(null)
  const formRef = useRef<HTMLFormElement>(null)

  function handleEdit(formData: FormData) {
    formData.set('userId', userId)
    startTransition(async () => {
      const res = await editSubAdminPermissions(formData)
      setEditResult(res)
      if (res.ok) {
        setEditOpen(false)
      }
    })
  }

  function handleRevoke() {
    const display = email ?? name ?? userId
    if (!confirm(`Revoke admin access for "${display}"? This cannot be undone.`)) return
    startTransition(async () => {
      await revokeSubAdmin(userId)
    })
  }

  return (
    <div className="flex items-center gap-2">
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogTrigger
          render={<Button variant="outline" size="sm" disabled={isPending} />}
        >
          Edit
        </DialogTrigger>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Edit Permissions</DialogTitle>
            <DialogDescription>
              Update permissions for {email ?? name ?? userId}.
            </DialogDescription>
          </DialogHeader>
          <form ref={formRef} action={handleEdit} className="space-y-4">
            <div className="space-y-2">
              <Label className="text-sm font-medium">Permissions</Label>
              <div className="grid gap-2 sm:grid-cols-2">
                {ADMIN_PERMISSIONS.map((perm) => (
                  <label
                    key={perm}
                    className="flex items-center gap-2 rounded-md border px-3 py-2 text-sm hover:bg-muted/50 cursor-pointer"
                  >
                    <input
                      type="checkbox"
                      name={`perm_${perm}`}
                      value="1"
                      defaultChecked={permissions.includes(perm)}
                      className="size-4 rounded border-input"
                    />
                    <span>{PERMISSION_LABELS[perm] ?? perm}</span>
                  </label>
                ))}
              </div>
            </div>

            {editResult && !editResult.ok && (
              <p className="text-sm text-destructive" role="alert">
                {editResult.error}
              </p>
            )}

            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => setEditOpen(false)}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={isPending}>
                {isPending ? 'Saving...' : 'Save Permissions'}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      <Button
        variant="outline"
        size="sm"
        disabled={isPending}
        onClick={handleRevoke}
        className="text-destructive hover:text-destructive"
      >
        Revoke
      </Button>
    </div>
  )
}
