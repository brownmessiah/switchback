import type { Metadata } from 'next'

import { SignInForm } from './sign-in-form'

export const metadata: Metadata = {
  title: 'Sign in — Outvers',
  description: 'Sign in to Outvers to book adventure experiences across India.',
}

interface Props {
  params: Promise<{ lng: string }>
}

export default async function SignInPage({ params }: Props) {
  const { lng } = await params

  return (
    <main className="flex min-h-[80vh] items-center justify-center px-4">
      <SignInForm lng={lng} />
    </main>
  )
}
