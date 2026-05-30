import { desc, eq } from 'drizzle-orm'

import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { db } from '@/db/client'
import { blogPosts } from '@/db/schema/blog-posts'
import { users } from '@/db/schema/users'

import { BlogPostCreateForm } from './blog-post-form'
import { BlogPostsTable, type BlogPostTableRow } from './blog-posts-table'

// ── Page ───────────────────────────────────────────────────────────

export default async function BlogPage() {
  const posts: BlogPostTableRow[] = await db
    .select({
      id: blogPosts.id,
      title: blogPosts.title,
      slug: blogPosts.slug,
      content: blogPosts.content,
      excerpt: blogPosts.excerpt,
      category: blogPosts.category,
      coverImageUrl: blogPosts.coverImageUrl,
      status: blogPosts.status,
      publishedAt: blogPosts.publishedAt,
      authorAdminId: blogPosts.authorAdminId,
      createdAt: blogPosts.createdAt,
      updatedAt: blogPosts.updatedAt,
      authorEmail: users.email,
      authorName: users.name,
    })
    .from(blogPosts)
    .leftJoin(users, eq(blogPosts.authorAdminId, users.id))
    .orderBy(desc(blogPosts.createdAt))

  const drafts = posts.filter((p) => p.status === 'draft')
  const published = posts.filter((p) => p.status === 'published')

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-h1 font-semibold tracking-tight">
          Blog CMS
        </h1>
        <p className="mt-1 text-xs text-muted-foreground">
          <span className="tabular-nums">{posts.length}</span> post
          {posts.length === 1 ? '' : 's'} &middot;{' '}
          <span className="tabular-nums">{published.length}</span> published
          &middot; <span className="tabular-nums">{drafts.length}</span> draft
          {drafts.length === 1 ? '' : 's'}
        </p>
      </div>

      <BlogPostCreateForm />

      <Tabs defaultValue="all">
        <TabsList>
          <TabsTrigger value="all">All ({posts.length})</TabsTrigger>
          <TabsTrigger value="published">
            Published ({published.length})
          </TabsTrigger>
          <TabsTrigger value="drafts">Drafts ({drafts.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="all">
          <BlogPostsTable posts={posts} emptyMessage="No blog posts yet." />
        </TabsContent>

        <TabsContent value="published">
          <BlogPostsTable posts={published} emptyMessage="No published posts." />
        </TabsContent>

        <TabsContent value="drafts">
          <BlogPostsTable posts={drafts} emptyMessage="No drafts." />
        </TabsContent>
      </Tabs>
    </div>
  )
}
