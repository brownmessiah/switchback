'use client'

import { useRef, useState, useTransition } from 'react'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
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
  const [revokeOpen, setRevokeOpen] = useState(false)
  const [editResult, setEditResult] = useState<SubAdminActionResult | null>(null)
  const [revokeError, setRevokeError] = useState<string | null>(null)
  const formRef = useRef<HTMLFormElement>(null)

  const display = name ?? email ?? userId

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
    setRevokeError(null)
    startTransition(async () => {
      const res = await revokeSubAdmin(userId)
      if (!res.ok) {
        setRevokeError(res.error)
        return
      }
      setRevokeOpen(false)
    })
  }

  return (
    <div className="flex items-center justify-end gap-2">
      {/* Edit permissions — the confirm itself: restates the full subset and
          requires an explicit Save before any access change is committed. */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogTrigger
          render={<Button variant="outline" size="sm" disabled={isPending} />}
        >
          Edit
        </DialogTrigger>
        <DialogContent className="sm:max-w-lg" data-testid="edit-subadmin-permissions">
          <DialogHeader>
            <DialogTitle>Edit Permissions</DialogTitle>
            <DialogDescription>
              Update the permission subset for {display}. Unchecking a permission
              removes that access; checking one grants it.
            </DialogDescription>
          </DialogHeader>
          <form ref={formRef} action={handleEdit} className="space-y-4">
            <div className="space-y-2">
              <Label className="text-sm font-medium">Permissions</Label>
              <div className="grid gap-2 sm:grid-cols-2">
                {ADMIN_PERMISSIONS.map((perm) => (
                  <label
                    key={perm}
                    className="flex cursor-pointer items-center gap-2 rounded-[var(--radius-control)] border px-3 py-2 text-sm hover:bg-muted/50"
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

            <DialogFooter>
              <DialogClose render={<Button type="button" variant="outline" />}>
                Cancel
              </DialogClose>
              <Button type="submit" disabled={isPending}>
                {isPending ? 'Saving…' : 'Save Permissions'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Revoke — destructive: gated behind an A4 confirm Dialog that restates
          the access change before commit (DESIGN.md §4 A4). Cancel is the
          non-default focus; the action only fires from the explicit confirm. */}
      <Dialog open={revokeOpen} onOpenChange={setRevokeOpen}>
        <DialogTrigger
          render={
            <Button
              variant="outline"
              size="sm"
              disabled={isPending}
              className="text-destructive hover:text-destructive"
              data-testid="subadmin-revoke-trigger"
            />
          }
        >
          Revoke
        </DialogTrigger>
        <DialogContent className="sm:max-w-md" data-testid="revoke-subadmin-confirm">
          <DialogHeader>
            <DialogTitle>Revoke admin access</DialogTitle>
            <DialogDescription>
              This permanently removes <span className="font-medium">all</span>{' '}
              admin access for{' '}
              <span className="font-medium text-foreground">{display}</span>. They
              will lose every permission immediately. This cannot be undone.
            </DialogDescription>
          </DialogHeader>

          {revokeError && (
            <p className="text-sm text-destructive" role="alert">
              {revokeError}
            </p>
          )}

          <DialogFooter>
            <DialogClose render={<Button type="button" variant="outline" />}>
              Cancel
            </DialogClose>
            <Button
              type="button"
              variant="destructive"
              disabled={isPending}
              onClick={handleRevoke}
            >
              {isPending ? 'Revoking…' : 'Revoke Access'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
