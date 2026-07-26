import type { Metadata } from 'next'
import Link from 'next/link'
import type { ReactElement } from 'react'
import { getTranslations, setRequestLocale } from 'next-intl/server'

import { BlogPostCard } from '@/components/blog/blog-post-card'
import { db } from '@/db/client'
import { listPublishedBlogPosts } from '@/lib/blog/queries'
import { env } from '@/lib/env'
import { generateAlternates } from '@/lib/seo/hreflang'
import { breadcrumbList } from '@/lib/seo/schemas/breadcrumb-list'

export const revalidate = 300

interface PageProps {
  params: Promise<{ locale: string }>
  searchParams: Promise<{ page?: string }>
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { locale } = await params
  const t = await getTranslations({ locale, namespace: 'BlogPage' })
  return {
    title: t('metadata.title'),
    description: t('metadata.description'),
    alternates: generateAlternates('/blog', locale),
  }
}

export default async function BlogIndexPage({
  params,
  searchParams,
}: PageProps): Promise<ReactElement> {
  const { locale } = await params
  setRequestLocale(locale)
  const t = await getTranslations({ locale, namespace: 'BlogPage' })
  const tCommon = await getTranslations({ locale, namespace: 'Common' })

  const { page: rawPage } = await searchParams
  const page = Math.max(1, Number.parseInt(rawPage ?? '1', 10) || 1)
  const { posts, totalPages } = await listPublishedBlogPosts(db, { page })

  const baseUrl = env.NEXT_PUBLIC_APP_URL.replace(/\/$/, '')
  const breadcrumbsJson = breadcrumbList([
    { name: tCommon('breadcrumb.home'), url: `${baseUrl}/` },
    { name: t('heading'), url: `${baseUrl}/blog` },
  ])

  return (
    <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6 lg:py-12">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbsJson) }}
      />

      <nav aria-label="Breadcrumb" className="mb-6">
        <ol className="flex items-center gap-1.5 text-sm text-muted-foreground">
          <li>
            <Link href="/" className="hover:text-foreground">
              {tCommon('breadcrumb.home')}
            </Link>
          </li>
          <li aria-hidden="true">/</li>
          <li className="text-foreground" aria-current="page">
            {t('heading')}
          </li>
        </ol>
      </nav>

      <header className="mb-[var(--space-section)]">
        <h1 className="font-heading text-h1 font-bold tracking-tight text-balance">
          {t('heading')}
        </h1>
        <p className="measure mt-3 text-lg text-muted-foreground">{t('subheading')}</p>
      </header>

      {posts.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-[var(--radius-card)] border border-dashed py-16 text-center">
          <p className="text-lg font-medium">{t('empty')}</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-[var(--space-grid-gap)] md:grid-cols-2 lg:grid-cols-3">
          {posts.map((post) => (
            <BlogPostCard key={post.slug} post={post} locale={locale} />
          ))}
        </div>
      )}

      {totalPages > 1 && (
        <nav aria-label={t('pagination.label')} className="mt-[var(--space-section)] flex items-center justify-center gap-4">
          {page > 1 && (
            <Link
              href={page === 2 ? '/blog' : `/blog?page=${page - 1}`}
              className="min-tap inline-flex items-center text-sm font-medium text-primary-strong hover:underline"
            >
              {t('pagination.prev')}
            </Link>
          )}
          <span className="text-sm tabular-nums text-muted-foreground">
            {t('pagination.page', { page, total: totalPages })}
          </span>
          {page < totalPages && (
            <Link
              href={`/blog?page=${page + 1}`}
              className="min-tap inline-flex items-center text-sm font-medium text-primary-strong hover:underline"
            >
              {t('pagination.next')}
            </Link>
          )}
        </nav>
      )}
    </main>
  )
}
