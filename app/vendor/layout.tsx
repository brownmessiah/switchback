import { headers } from 'next/headers'
import { redirect } from 'next/navigation'

import { auth } from '@/lib/auth'

import { VendorSidebar } from './vendor-sidebar'

export default async function VendorLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) {
    redirect('/en/sign-in')
  }

  return (
    <div className="flex min-h-[80vh]">
      <VendorSidebar userName={session.user.name ?? 'Vendor'} />
      <main className="flex-1 px-4 py-8 sm:px-8 lg:px-12">{children}</main>
    </div>
  )
}
