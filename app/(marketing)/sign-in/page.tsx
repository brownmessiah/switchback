import type { Metadata } from 'next'

import { SignInForm } from './sign-in-form'

export const metadata: Metadata = {
  title: 'Sign in — Outvers',
  description: 'Sign in to Outvers to book adventure experiences across India.',
}

export default function SignInPage() {
  return (
    <main className="flex min-h-[80vh] items-center justify-center px-4">
      <SignInForm />
    </main>
  )
}
