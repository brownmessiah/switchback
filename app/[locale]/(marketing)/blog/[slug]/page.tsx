import type { Metadata } from 'next'
import Image from 'next/image'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import type { ReactElement } from 'react'
import { getTranslations, setRequestLocale } from 'next-intl/server'
import ReactMarkdown from 'react-markdown'

import { Badge } from '@/components/ui/badge'
import { db } from '@/db/client'
import { getPublishedBlogPostBySlug } from '@/lib/blog/queries'
import { env } from '@/lib/env'
import { generateAlternates } from '@/lib/seo/hreflang'
import { article } from '@/lib/seo/schemas/article'
import { breadcrumbList } from '@/lib/seo/schemas/breadcrumb-list'

export const revalidate = 300

interface PageProps {
  params: Promise<{ locale: string; slug: string }>
}

function formatDate(date: Date | null, locale: string): string {
  if (!date) return ''
  return new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'long', year: 'numeric' }).format(date)
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { locale, slug } = await params
  const post = await getPublishedBlogPostBySlug(db, slug)
  if (!post) {
    const tCommon = await getTranslations({ locale, namespace: 'Common' })
    return { title: tCommon('notFound'), description: '', alternates: { canonical: '' } }
  }
  return {
    title: post.title,
    description: post.excerpt ?? '',
    alternates: generateAlternates(`/blog/${post.slug}`, locale),
    openGraph: post.coverImageUrl
      ? { title: post.title, description: post.excerpt ?? '', images: [post.coverImageUrl], type: 'article' }
      : { title: post.title, description: post.excerpt ?? '', type: 'article' },
  }
}

const MD_COMPONENTS = {
  h1: (p: { children?: React.ReactNode }) => (
    <h2 className="mt-8 font-heading text-h2 font-semibold tracking-tight">{p.children}</h2>
  ),
  h2: (p: { children?: React.ReactNode }) => (
    <h2 className="mt-8 font-heading text-h3 font-semibold tracking-tight">{p.children}</h2>
  ),
  h3: (p: { children?: React.ReactNode }) => (
    <h3 className="mt-6 font-heading text-lg font-semibold tracking-tight">{p.children}</h3>
  ),
  p: (p: { children?: React.ReactNode }) => (
    <p className="mt-4 leading-relaxed text-foreground">{p.children}</p>
  ),
  ul: (p: { children?: React.ReactNode }) => (
    <ul className="mt-4 list-disc space-y-1 pl-6 text-foreground">{p.children}</ul>
  ),
  ol: (p: { children?: React.ReactNode }) => (
    <ol className="mt-4 list-decimal space-y-1 pl-6 text-foreground">{p.children}</ol>
  ),
  li: (p: { children?: React.ReactNode }) => <li className="leading-relaxed">{p.children}</li>,
  a: (p: { href?: string; children?: React.ReactNode }) => (
    <a href={p.href} className="text-primary-strong underline">
      {p.children}
    </a>
  ),
  strong: (p: { children?: React.ReactNode }) => (
    <strong className="font-semibold text-foreground">{p.children}</strong>
  ),
}

export default async function BlogArticlePage({ params }: PageProps): Promise<ReactElement> {
  const { locale, slug } = await params
  setRequestLocale(locale)
  const post = await getPublishedBlogPostBySlug(db, slug)
  if (!post) notFound()

  const t = await getTranslations({ locale, namespace: 'BlogPage' })
  const tCommon = await getTranslations({ locale, namespace: 'Common' })

  const baseUrl = env.NEXT_PUBLIC_APP_URL.replace(/\/$/, '')
  const url = `${baseUrl}/blog/${post.slug}`
  const authorName = post.authorName ?? t('article.defaultAuthor')
  const publishedDate = formatDate(post.publishedAt, locale)

  const articleJson = article({
    headline: post.title,
    url,
    datePublished: (post.publishedAt ?? new Date()).toISOString().slice(0, 10),
    authorName,
    ...(post.coverImageUrl ? { image: post.coverImageUrl } : {}),
    ...(post.excerpt ? { description: post.excerpt } : {}),
    ...(post.updatedAt ? { dateModified: post.updatedAt.toISOString().slice(0, 10) } : {}),
  })
  const breadcrumbsJson = breadcrumbList([
    { name: tCommon('breadcrumb.home'), url: `${baseUrl}/` },
    { name: t('heading'), url: `${baseUrl}/blog` },
    { name: post.title, url },
  ])

  return (
    <main className="mx-auto max-w-3xl px-4 py-8 sm:px-6 lg:py-12">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(articleJson) }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbsJson) }} />

      <nav aria-label="Breadcrumb" className="mb-6">
        <ol className="flex flex-wrap items-center gap-1.5 text-sm text-muted-foreground">
          <li>
            <Link href="/" className="hover:text-foreground">
              {tCommon('breadcrumb.home')}
            </Link>
          </li>
          <li aria-hidden="true">/</li>
          <li>
            <Link href="/blog" className="hover:text-foreground">
              {t('heading')}
            </Link>
          </li>
          <li aria-hidden="true">/</li>
          <li className="text-foreground" aria-current="page">
            {post.title}
          </li>
        </ol>
      </nav>

      <article>
        <header className="mb-8">
          <Badge variant="secondary" className="capitalize">
            {post.category}
          </Badge>
          <h1 className="mt-3 font-heading text-h1 font-bold tracking-tight text-balance">
            {post.title}
          </h1>
          <p className="mt-3 text-sm text-muted-foreground">
            {t('article.by', { author: authorName })}
            {publishedDate && (
              <>
                {' · '}
                <time dateTime={post.publishedAt?.toISOString()}>{publishedDate}</time>
              </>
            )}
          </p>
        </header>

        {post.coverImageUrl && (
          <div className="relative mb-8 aspect-[16/9] w-full overflow-hidden rounded-[var(--radius-card)]">
            <Image
              src={post.coverImageUrl}
              alt=""
              role="presentation"
              fill
              priority
              className="object-cover"
              sizes="(max-width: 768px) 100vw, 768px"
            />
          </div>
        )}

        <div className="measure-wide">
          <ReactMarkdown components={MD_COMPONENTS}>{post.content}</ReactMarkdown>
        </div>
      </article>

      <div className="mt-[var(--space-section)] border-t border-border pt-6">
        <Link href="/blog" className="text-sm font-medium text-primary-strong hover:underline">
          {t('article.backToBlog')}
        </Link>
      </div>
    </main>
  )
}
