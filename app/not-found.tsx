import Link from 'next/link'

import { buttonVariants } from '@/components/ui/button'

export default function NotFound() {
  return (
    <main className="flex min-h-[60vh] flex-col items-center justify-center px-4 text-center">
      <h1 className="text-6xl font-semibold">404</h1>
      <p className="mt-4 text-lg text-muted-foreground">
        This page doesn't exist or has been moved.
      </p>
      <Link href="/" className={buttonVariants({ className: 'mt-6' })}>
        Back to home
      </Link>
    </main>
  )
}
