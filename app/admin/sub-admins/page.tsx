import { eq } from 'drizzle-orm'
import { headers } from 'next/headers'
import { notFound } from 'next/navigation'

import { AdminStatusBadge } from '@/app/admin/_components/admin-status-badge'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  ResponsiveTable,
  type ResponsiveTableColumn,
} from '@/components/ui/responsive-table'
import { db } from '@/db/client'
import { adminProfiles } from '@/db/schema/admin-profiles'
import { users } from '@/db/schema/users'
import { auth } from '@/lib/auth'
import { ADMIN_PERMISSIONS, requirePermission } from '@/lib/auth/permissions'

import { InviteSubAdminForm } from './invite-form'
import { SubAdminActionsCell } from './sub-admin-actions-cell'

// ── Helpers ────────────────────────────────────────────────────────

function formatDate(d: Date | null): string {
  if (!d) return '—'
  return new Date(d).toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })
}

function isFullAdmin(permissions: string[]): boolean {
  return ADMIN_PERMISSIONS.every((p) => permissions.includes(p))
}

function permissionLabel(p: string): string {
  return p.replace(/_/g, ' ')
}

// ── Page ───────────────────────────────────────────────────────────

export default async function SubAdminsPage() {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) notFound()
  await requirePermission(db, session.user.id, 'sub_admins')

  // Fetch all admin profiles with user info
  const admins = await db
    .select({
      userId: adminProfiles.userId,
      permissions: adminProfiles.permissions,
      invitedByUserId: adminProfiles.invitedByUserId,
      createdAt: adminProfiles.createdAt,
      email: users.email,
      name: users.name,
    })
    .from(adminProfiles)
    .innerJoin(users, eq(adminProfiles.userId, users.id))
    .orderBy(adminProfiles.createdAt)

  const fullAdmins = admins.filter((a) => isFullAdmin(a.permissions))
  const subAdmins = admins.filter((a) => !isFullAdmin(a.permissions))

  // Decorate each row with the per-row flags the A3 cells need, so the
  // `<ResponsiveTable>` column renderers stay pure functions of the row.
  const adminRows = admins.map((admin) => ({
    ...admin,
    isFull: isFullAdmin(admin.permissions),
    isSelf: admin.userId === session.user.id,
  }))

  type AdminRow = (typeof adminRows)[number]

  const columns: ResponsiveTableColumn<AdminRow>[] = [
    {
      key: 'user',
      header: 'User',
      primary: true,
      cell: (admin) => (
        <div>
          <p className="text-sm font-medium">
            {admin.name ?? admin.email ?? admin.userId}
          </p>
          {admin.email && admin.name && (
            <p className="text-xs text-muted-foreground">{admin.email}</p>
          )}
        </div>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      cell: (admin) => (
        <div className="flex flex-wrap items-center justify-end gap-1 md:justify-start">
          <span data-testid="subadmin-status-badge">
            <AdminStatusBadge
              status={admin.isFull ? 'active' : 'restricted'}
              label={admin.isFull ? 'Full Admin' : 'Sub-Admin'}
            />
          </span>
          {admin.isSelf && (
            <Badge variant="outline" className="text-2xs">
              You
            </Badge>
          )}
        </div>
      ),
    },
    {
      key: 'permissions',
      header: 'Permission subset',
      cell: (admin) =>
        admin.isFull ? (
          <span className="text-sm text-muted-foreground">
            All {ADMIN_PERMISSIONS.length} permissions
          </span>
        ) : (
          <div className="flex flex-wrap justify-end gap-1 md:justify-start">
            {admin.permissions.map((p) => (
              <Badge key={p} variant="outline" className="text-2xs">
                {permissionLabel(p)}
              </Badge>
            ))}
          </div>
        ),
    },
    {
      key: 'since',
      header: 'Since',
      align: 'right',
      cell: (admin) => (
        <span className="text-sm text-muted-foreground tabular-nums">
          {formatDate(admin.createdAt)}
        </span>
      ),
    },
    {
      key: 'actions',
      header: 'Actions',
      align: 'right',
      cell: (admin) =>
        admin.isSelf ? (
          <span className="text-xs text-muted-foreground">—</span>
        ) : (
          <SubAdminActionsCell
            userId={admin.userId}
            email={admin.email}
            name={admin.name}
            permissions={admin.permissions}
          />
        ),
    },
  ]

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-h1 font-semibold tracking-tight">
          Sub-Admin Management
        </h1>
        <p className="mt-1 text-xs text-muted-foreground">
          {admins.length} admin{admins.length === 1 ? '' : 's'} &middot;{' '}
          {fullAdmins.length} full admin{fullAdmins.length === 1 ? '' : 's'} &middot;{' '}
          {subAdmins.length} sub-admin{subAdmins.length === 1 ? '' : 's'}
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="font-heading text-h3">Invite Sub-Admin</CardTitle>
        </CardHeader>
        <CardContent>
          <InviteSubAdminForm />
        </CardContent>
      </Card>

      <section className="space-y-3" aria-label="Current Admins">
        <h2 className="font-heading text-h3">Current Admins</h2>
        <ResponsiveTable<AdminRow>
          columns={columns}
          rows={adminRows}
          getRowKey={(admin) => admin.userId}
          caption="Admins and sub-admins with their permission subset and status"
          empty="No admins found."
        />
      </section>
    </div>
  )
}
