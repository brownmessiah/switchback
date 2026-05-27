import { eq } from 'drizzle-orm'
import { headers } from 'next/headers'
import { notFound } from 'next/navigation'

import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { db } from '@/db/client'
import { adminProfiles } from '@/db/schema/admin-profiles'
import { users } from '@/db/schema/users'
import { auth } from '@/lib/auth'
import { ADMIN_PERMISSIONS, requirePermission } from '@/lib/auth/permissions'

import { InviteSubAdminForm } from './invite-form'
import { SubAdminActionsCell } from './sub-admin-actions-cell'

// ── Helpers ────────────────────────────────────────────────────────

function formatDate(d: Date | null): string {
  if (!d) return '--'
  return new Date(d).toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })
}

function isFullAdmin(permissions: string[]): boolean {
  return ADMIN_PERMISSIONS.every((p) => permissions.includes(p))
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

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Sub-Admin Management</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {admins.length} admin{admins.length === 1 ? '' : 's'} &middot;{' '}
          {fullAdmins.length} full admin{fullAdmins.length === 1 ? '' : 's'} &middot;{' '}
          {subAdmins.length} sub-admin{subAdmins.length === 1 ? '' : 's'}
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Invite Sub-Admin</CardTitle>
        </CardHeader>
        <CardContent>
          <InviteSubAdminForm />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Current Admins</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>User</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Permissions</TableHead>
                <TableHead>Since</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {admins.length === 0 && (
                <TableRow>
                  <TableCell
                    colSpan={5}
                    className="py-8 text-center text-muted-foreground"
                  >
                    No admins found.
                  </TableCell>
                </TableRow>
              )}
              {admins.map((admin) => {
                const isFull = isFullAdmin(admin.permissions)
                const isSelf = admin.userId === session.user.id

                return (
                  <TableRow key={admin.userId}>
                    <TableCell>
                      <div>
                        <p className="text-sm font-medium">
                          {admin.name ?? admin.email ?? admin.userId}
                        </p>
                        {admin.email && admin.name && (
                          <p className="text-xs text-muted-foreground">{admin.email}</p>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant={isFull ? 'default' : 'secondary'} className="text-xs">
                        {isFull ? 'Full Admin' : 'Sub-Admin'}
                      </Badge>
                      {isSelf && (
                        <Badge variant="outline" className="ml-1 text-xs">
                          You
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="max-w-[300px]">
                      {isFull ? (
                        <span className="text-sm text-muted-foreground">All 16 permissions</span>
                      ) : (
                        <div className="flex flex-wrap gap-1">
                          {admin.permissions.map((p) => (
                            <Badge
                              key={p}
                              variant="outline"
                              className="text-xs"
                            >
                              {p.replace(/_/g, ' ')}
                            </Badge>
                          ))}
                        </div>
                      )}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {formatDate(admin.createdAt)}
                    </TableCell>
                    <TableCell>
                      {isSelf ? (
                        <span className="text-xs text-muted-foreground">--</span>
                      ) : (
                        <SubAdminActionsCell
                          userId={admin.userId}
                          email={admin.email}
                          name={admin.name}
                          permissions={admin.permissions}
                        />
                      )}
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  )
}
