import { eq } from 'drizzle-orm'
import { headers } from 'next/headers'
import { notFound, redirect } from 'next/navigation'

import { db } from '@/db/client'
import { experiences } from '@/db/schema'
import { auth } from '@/lib/auth'

import { CheckoutForm } from './checkout-form'

interface PageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

export default async function CheckoutPage({ searchParams }: PageProps) {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) {
    redirect('/sign-in')
  }

  const params = await searchParams
  const experienceId = typeof params.experienceId === 'string' ? params.experienceId : null
  const slotId = typeof params.slotId === 'string' ? params.slotId : null
  const participantCount = typeof params.participants === 'string'
    ? parseInt(params.participants, 10)
    : 2

  if (!experienceId) notFound()

  const [experienceRow] = await db
    .select()
    .from(experiences)
    .where(eq(experiences.id, experienceId))
    .limit(1)

  if (!experienceRow || experienceRow.status !== 'published') notFound()

  const pricePerPerson = participantCount <= 2
    ? Number(experienceRow.pricePerPerson_1_2)
    : participantCount <= 5
      ? Number(experienceRow.pricePerPerson_3_5)
      : Number(experienceRow.pricePerPerson_6_plus)

  const grossTotal = pricePerPerson * participantCount

  return (
    <main className="mx-auto max-w-5xl px-4 py-12 sm:px-6">
      <h1 className="mb-8 font-heading text-2xl font-semibold tracking-tight sm:text-3xl">
        Checkout
      </h1>

      <CheckoutForm
        experienceId={experienceId}
        experienceTitle={experienceRow.title}
        slotId={slotId}
        participantCount={participantCount}
        pricePerPerson={pricePerPerson}
        grossTotal={grossTotal}
        cancellationPreset={experienceRow.cancellationPreset}
        paymentModesAllowed={experienceRow.paymentModesAllowed as string[]}
        customerName={session.user.name ?? null}
        customerEmail={session.user.email ?? null}
      />
    </main>
  )
}
