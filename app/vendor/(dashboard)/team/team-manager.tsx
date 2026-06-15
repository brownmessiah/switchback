'use client'

import { Loader2, Pencil, Plus, Trash2, UserCog } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useRouter } from 'next/navigation'
import { useId, useState } from 'react'
import { toast } from 'sonner'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { ResponsiveTable } from '@/components/ui/responsive-table'
import type { VendorMemberStatus } from '@/db/schema/vendor-team-members'

import {
  deactivateTeamMember,
  editTeamMemberRole,
  inviteTeamMember,
  removeTeamMember,
} from './actions'
import type { AssignableRole } from './team-core'
import {
  ASSIGNABLE_ROLE_OPTIONS,
  formatLastActive,
  roleBadgeVariant,
  roleLabelKey,
  statusBadgeVariant,
} from './team-display'

/**
 * Interactive Team & Roles surface (issue #05) — the `'use client'` half of
 * `/vendor/team`. The server page resolves the gate + loads the roster and
 * passes SERIALIZABLE props down; this component owns the Add-User modal, the
 * per-row Edit (role + status) modal, and Remove (confirm) — each wired to the
 * issue-04 Server Actions, which themselves re-gate on `team:manage`.
 *
 * Role-dropdown decision: only the FOUR assignable roles are offered (Manager,
 * Booking Staff, Guide, Accountant). The Owner is the implicit account holder,
 * rendered by the page as a protected top row (no Edit/Remove) — never an
 * assignable option. So "the five roles" = Owner (implicit) + these four.
 */

/** A roster row as serialized by the page (Dates → ISO strings over the wire). */
export interface TeamMemberView {
  memberUserId: string
  name: string | null
  email: string | null
  role: AssignableRole
  status: VendorMemberStatus
  /** ISO string or null — formatted client-side for the locale. */
  lastActiveAt: string | null
}

export interface TeamManagerProps {
  members: readonly TeamMemberView[]
  /** The Owner's display name (or email) for the protected top row. */
  ownerName: string
}

export function TeamManager({ members, ownerName }: TeamManagerProps) {
  const t = useTranslations('VendorTeam')
  const router = useRouter()

  const [addOpen, setAddOpen] = useState(false)
  const [editing, setEditing] = useState<TeamMemberView | null>(null)
  const [removing, setRemoving] = useState<TeamMemberView | null>(null)

  function roleLabel(role: AssignableRole): string {
    return t(roleLabelKey(role))
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{t('title')}</h1>
          <p className="mt-1 text-muted-foreground">{t('subtitle')}</p>
        </div>
        <Button type="button" onClick={() => setAddOpen(true)}>
          <Plus aria-hidden="true" />
          {t('addUser')}
        </Button>
      </div>

      {/* Owner — implicit, protected, full access. No Edit/Remove (the Owner is
          `vendor_profiles.user_id`, never a membership row, so it cannot be
          mutated). Rendered above the manageable member roster. */}
      <Card data-testid="team-owner-row">
        <CardContent className="flex flex-wrap items-center justify-between gap-3 py-4">
          <div className="min-w-0">
            <p className="font-heading text-sm font-medium leading-snug">{ownerName}</p>
            <p className="mt-0.5 text-xs text-muted-foreground">{t('ownerRowYou')}</p>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="default" className="text-xs">
              {t('ownerRowLabel')}
            </Badge>
            <Badge variant="success" className="text-xs">
              {t('ownerRoleLabel')}
            </Badge>
          </div>
        </CardContent>
      </Card>

      <ResponsiveTable<TeamMemberView>
        caption={t('title')}
        rows={members}
        getRowKey={(r) => r.memberUserId}
        rowProps={(r) => ({ 'data-member-id': r.memberUserId, 'data-role': r.role })}
        empty={t('empty')}
        columns={[
          {
            key: 'name',
            header: t('columnName'),
            primary: true,
            cell: (r) => r.name ?? '—',
          },
          {
            key: 'email',
            header: t('columnEmail'),
            cell: (r) => r.email ?? '—',
          },
          {
            key: 'role',
            header: t('columnRole'),
            cell: (r) => (
              <Badge variant={roleBadgeVariant(r.role)} className="text-xs">
                {roleLabel(r.role)}
              </Badge>
            ),
          },
          {
            key: 'status',
            header: t('columnStatus'),
            cell: (r) => (
              <Badge variant={statusBadgeVariant(r.status)} className="text-xs">
                {r.status === 'active' ? t('statusActive') : t('statusInactive')}
              </Badge>
            ),
          },
          {
            key: 'lastActive',
            header: t('columnLastActive'),
            align: 'right',
            cell: (r) => formatLastActive(r.lastActiveAt ? new Date(r.lastActiveAt) : null),
          },
          {
            key: 'actions',
            header: t('columnActions'),
            align: 'right',
            cell: (r) => (
              <div className="flex items-center justify-end gap-1">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setEditing(r)}
                >
                  <Pencil aria-hidden="true" />
                  {t('edit')}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="text-destructive"
                  onClick={() => setRemoving(r)}
                >
                  <Trash2 aria-hidden="true" />
                  {t('remove')}
                </Button>
              </div>
            ),
          },
        ]}
      />

      <AddUserDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        onDone={() => router.refresh()}
      />
      <EditMemberDialog
        member={editing}
        onOpenChange={(open) => {
          if (!open) setEditing(null)
        }}
        onDone={() => router.refresh()}
      />
      <RemoveMemberDialog
        member={removing}
        ownerName={ownerName}
        onOpenChange={(open) => {
          if (!open) setRemoving(null)
        }}
        onDone={() => router.refresh()}
      />
    </div>
  )
}

// ── Add-User modal ──────────────────────────────────────────────────────────

function AddUserDialog({
  open,
  onOpenChange,
  onDone,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onDone: () => void
}) {
  const t = useTranslations('VendorTeam')
  const nameId = useId()
  const emailId = useId()
  const phoneId = useId()

  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [role, setRole] = useState<AssignableRole>('manager')
  const [status, setStatus] = useState<VendorMemberStatus>('active')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  function reset() {
    setFullName('')
    setEmail('')
    setPhone('')
    setRole('manager')
    setStatus('active')
    setError(null)
  }

  async function handleSubmit() {
    if (submitting) return
    setSubmitting(true)
    setError(null)
    try {
      const result = await inviteTeamMember({
        fullName: fullName.trim() || undefined,
        email: email.trim(),
        phone: phone.trim() || undefined,
        role,
        status,
      })
      if (!result.ok) {
        setError(result.error)
        return
      }
      toast.success(t('addUser'))
      onOpenChange(false)
      reset()
      onDone()
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next)
        if (!next) reset()
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('addUserTitle')}</DialogTitle>
          <DialogDescription>{t('addUserDescription')}</DialogDescription>
        </DialogHeader>

        <form
          onSubmit={(e) => {
            e.preventDefault()
            void handleSubmit()
          }}
          className="space-y-4"
        >
          <div className="space-y-2">
            <Label htmlFor={nameId}>{t('fullNameLabel')}</Label>
            <Input
              id={nameId}
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              autoComplete="off"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor={emailId}>{t('emailLabel')}</Label>
            <Input
              id={emailId}
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="off"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor={phoneId}>
              {t('phoneLabel')}{' '}
              <span className="text-muted-foreground">({t('phoneOptional')})</span>
            </Label>
            <Input
              id={phoneId}
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              autoComplete="off"
            />
          </div>

          <RoleStatusFields
            role={role}
            status={status}
            onRoleChange={setRole}
            onStatusChange={setStatus}
          />

          {error ? (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          ) : null}

          <DialogFooter>
            <DialogClose
              render={
                <Button type="button" variant="outline">
                  {t('cancel')}
                </Button>
              }
            />
            <Button type="submit" disabled={submitting || email.trim().length === 0}>
              {submitting ? (
                <>
                  <Loader2 aria-hidden="true" className="animate-spin" />
                  {t('sending')}
                </>
              ) : (
                <>
                  <Plus aria-hidden="true" />
                  {t('addUser')}
                </>
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

// ── Edit modal (role + status) ──────────────────────────────────────────────

function EditMemberDialog({
  member,
  onOpenChange,
  onDone,
}: {
  member: TeamMemberView | null
  onOpenChange: (open: boolean) => void
  onDone: () => void
}) {
  const t = useTranslations('VendorTeam')
  const [role, setRole] = useState<AssignableRole>('manager')
  const [status, setStatus] = useState<VendorMemberStatus>('active')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  // Re-seed the editor's local state when a new member is opened.
  const [seededFor, setSeededFor] = useState<string | null>(null)

  if (member && seededFor !== member.memberUserId) {
    setSeededFor(member.memberUserId)
    setRole(member.role)
    setStatus(member.status)
    setError(null)
  }

  async function handleSubmit() {
    if (!member || submitting) return
    setSubmitting(true)
    setError(null)
    try {
      // Role and status are independent backend actions; apply only what changed
      // so an unchanged field never writes a redundant audit log.
      if (role !== member.role) {
        const roleResult = await editTeamMemberRole({
          memberUserId: member.memberUserId,
          role,
        })
        if (!roleResult.ok) {
          setError(roleResult.error)
          return
        }
      }
      if (status !== member.status) {
        const statusResult = await deactivateTeamMember({
          memberUserId: member.memberUserId,
          status,
        })
        if (!statusResult.ok) {
          setError(statusResult.error)
          return
        }
      }
      toast.success(t('save'))
      onOpenChange(false)
      onDone()
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={member !== null} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('editTitle')}</DialogTitle>
          <DialogDescription>{t('editDescription')}</DialogDescription>
        </DialogHeader>

        <form
          onSubmit={(e) => {
            e.preventDefault()
            void handleSubmit()
          }}
          className="space-y-4"
        >
          <RoleStatusFields
            role={role}
            status={status}
            onRoleChange={setRole}
            onStatusChange={setStatus}
          />

          {error ? (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          ) : null}

          <DialogFooter>
            <DialogClose
              render={
                <Button type="button" variant="outline">
                  {t('cancel')}
                </Button>
              }
            />
            <Button type="submit" disabled={submitting}>
              {submitting ? (
                <>
                  <Loader2 aria-hidden="true" className="animate-spin" />
                  {t('sending')}
                </>
              ) : (
                <>
                  <UserCog aria-hidden="true" />
                  {t('save')}
                </>
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

// ── Remove confirm modal ────────────────────────────────────────────────────

function RemoveMemberDialog({
  member,
  ownerName,
  onOpenChange,
  onDone,
}: {
  member: TeamMemberView | null
  ownerName: string
  onOpenChange: (open: boolean) => void
  onDone: () => void
}) {
  const t = useTranslations('VendorTeam')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  async function handleConfirm() {
    if (!member || submitting) return
    setSubmitting(true)
    setError(null)
    try {
      const result = await removeTeamMember({ memberUserId: member.memberUserId })
      if (!result.ok) {
        setError(result.error)
        return
      }
      toast.success(t('remove'))
      onOpenChange(false)
      onDone()
    } finally {
      setSubmitting(false)
    }
  }

  const memberLabel = member?.name ?? member?.email ?? ownerName

  return (
    <Dialog open={member !== null} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('removeTitle')}</DialogTitle>
          <DialogDescription>
            {t('removeDescription')}
          </DialogDescription>
        </DialogHeader>

        <p className="text-sm text-card-foreground">{memberLabel}</p>

        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : null}

        <DialogFooter>
          <DialogClose
            render={
              <Button type="button" variant="outline" autoFocus>
                {t('cancel')}
              </Button>
            }
          />
          <Button
            type="button"
            variant="destructive"
            disabled={submitting}
            onClick={handleConfirm}
          >
            {submitting ? (
              <>
                <Loader2 aria-hidden="true" className="animate-spin" />
                {t('sending')}
              </>
            ) : (
              <>
                <Trash2 aria-hidden="true" />
                {t('removeConfirm')}
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ── Shared role + status fields ─────────────────────────────────────────────

function RoleStatusFields({
  role,
  status,
  onRoleChange,
  onStatusChange,
}: {
  role: AssignableRole
  status: VendorMemberStatus
  onRoleChange: (role: AssignableRole) => void
  onStatusChange: (status: VendorMemberStatus) => void
}) {
  const t = useTranslations('VendorTeam')
  const roleId = useId()
  const statusId = useId()

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <div className="space-y-2">
        <Label htmlFor={roleId}>{t('roleLabel')}</Label>
        <Select
          value={role}
          onValueChange={(v) => onRoleChange((v as AssignableRole | null) ?? 'manager')}
        >
          <SelectTrigger id={roleId} className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {ASSIGNABLE_ROLE_OPTIONS.map((option) => (
              <SelectItem key={option} value={option}>
                {t(roleLabelKey(option))}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-2">
        <Label htmlFor={statusId}>{t('statusLabel')}</Label>
        <Select
          value={status}
          onValueChange={(v) =>
            onStatusChange((v as VendorMemberStatus | null) ?? 'active')
          }
        >
          <SelectTrigger id={statusId} className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="active">{t('statusActive')}</SelectItem>
            <SelectItem value="inactive">{t('statusInactive')}</SelectItem>
          </SelectContent>
        </Select>
      </div>
    </div>
  )
}
