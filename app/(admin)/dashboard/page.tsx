import { count, eq, sql } from 'drizzle-orm'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { db } from '@/db/client'
import { bookings, experiences, users, vendorProfiles } from '@/db/schema'

export default async function AdminDashboardPage() {
  const [[userCount], [vendorCount], [expCount], [bookingCount]] = await Promise.all([
    db.select({ count: count() }).from(users),
    db.select({ count: count() }).from(vendorProfiles),
    db.select({ count: count() }).from(experiences),
    db.select({ count: count() }).from(bookings),
  ])

  return (
    <div className="space-y-8">
      <h1 className="text-2xl font-semibold tracking-tight">Admin overview</h1>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Users</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-semibold">{userCount?.count ?? 0}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Vendors</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-semibold">{vendorCount?.count ?? 0}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Experiences</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-semibold">{expCount?.count ?? 0}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Bookings</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-semibold">{bookingCount?.count ?? 0}</p>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
