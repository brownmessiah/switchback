import { desc, eq } from 'drizzle-orm'

import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { db } from '@/db/client'
import { blogPosts } from '@/db/schema/blog-posts'
import { users } from '@/db/schema/users'

import { BlogPostActionsCell } from './blog-post-actions-cell'
import { BlogPostCreateForm } from './blog-post-form'

// ── Helpers ────────────────────────────────────────────────────────

function formatDate(d: Date | null): string {
  if (!d) return '--'
  return new Date(d).toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1)
}

// ── Page ───────────────────────────────────────────────────────────

export default async function BlogPage() {
  const posts = await db
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
        <h1 className="text-2xl font-semibold tracking-tight">Blog CMS</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {posts.length} post{posts.length === 1 ? '' : 's'} &middot;{' '}
          {published.length} published &middot; {drafts.length} draft
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
          <PostTable posts={posts} emptyMessage="No blog posts yet." />
        </TabsContent>

        <TabsContent value="published">
          <PostTable
            posts={published}
            emptyMessage="No published posts."
          />
        </TabsContent>

        <TabsContent value="drafts">
          <PostTable posts={drafts} emptyMessage="No drafts." />
        </TabsContent>
      </Tabs>
    </div>
  )
}

// ── Shared post table ─────────────────────────────────────────────

interface PostRow {
  id: string
  title: string
  slug: string
  content: string
  excerpt: string | null
  category: string
  coverImageUrl: string | null
  status: string
  publishedAt: Date | null
  authorAdminId: string
  createdAt: Date
  updatedAt: Date
  authorEmail: string | null
  authorName: string | null
}

function PostTable({
  posts,
  emptyMessage,
}: {
  posts: PostRow[]
  emptyMessage: string
}) {
  return (
    <Card>
      <CardContent className="p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Title</TableHead>
              <TableHead>Slug</TableHead>
              <TableHead>Category</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Published</TableHead>
              <TableHead>Author</TableHead>
              <TableHead>Created</TableHead>
              <TableHead>Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {posts.length === 0 && (
              <TableRow>
                <TableCell
                  colSpan={8}
                  className="py-8 text-center text-muted-foreground"
                >
                  {emptyMessage}
                </TableCell>
              </TableRow>
            )}
            {posts.map((p) => (
              <TableRow key={p.id} data-blog-post-id={p.id}>
                <TableCell className="text-sm font-medium max-w-[200px] truncate">
                  {p.title}
                </TableCell>
                <TableCell className="text-sm font-mono text-muted-foreground max-w-[150px] truncate">
                  {p.slug}
                </TableCell>
                <TableCell>
                  <Badge variant="secondary" className="text-xs">
                    {capitalize(p.category)}
                  </Badge>
                </TableCell>
                <TableCell>
                  <Badge
                    variant={
                      p.status === 'published' ? 'default' : 'outline'
                    }
                    className="text-xs"
                  >
                    {capitalize(p.status)}
                  </Badge>
                </TableCell>
                <TableCell className="text-sm text-muted-foreground">
                  {formatDate(p.publishedAt)}
                </TableCell>
                <TableCell className="text-sm text-muted-foreground">
                  {p.authorEmail ?? p.authorName ?? '--'}
                </TableCell>
                <TableCell className="text-sm text-muted-foreground">
                  {formatDate(p.createdAt)}
                </TableCell>
                <TableCell>
                  <BlogPostActionsCell
                    id={p.id}
                    title={p.title}
                    content={p.content}
                    excerpt={p.excerpt}
                    category={p.category}
                    coverImageUrl={p.coverImageUrl}
                    status={p.status}
                  />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  )
}
