'use client'

import { useState, useTransition } from 'react'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { BLOG_CATEGORIES } from '@/db/schema/blog-posts'

import {
  deleteBlogPost,
  updateBlogPost,
  uploadBlogCoverImage,
  type BlogActionResult,
  type UpdateBlogPostInput,
} from './actions'

interface BlogPostActionsCellProps {
  id: string
  title: string
  content: string
  excerpt: string | null
  category: string
  coverImageUrl: string | null
  status: string
}

export function BlogPostActionsCell({
  id,
  title,
  content,
  excerpt,
  category,
  coverImageUrl,
  status,
}: BlogPostActionsCellProps) {
  const [isPending, startTransition] = useTransition()
  const [editOpen, setEditOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [editResult, setEditResult] = useState<BlogActionResult | null>(null)
  const [editCategory, setEditCategory] = useState(category)
  const [editContent, setEditContent] = useState(content)
  const [editCoverImageUrl, setEditCoverImageUrl] = useState(coverImageUrl)
  const [isUploading, setIsUploading] = useState(false)
  const [showPreview, setShowPreview] = useState(false)

  function handleEdit(formData: FormData) {
    startTransition(async () => {
      const input: UpdateBlogPostInput = {
        id,
        title: String(formData.get('title') ?? ''),
        content: editContent,
        excerpt: String(formData.get('excerpt') ?? '') || null,
        category: editCategory as UpdateBlogPostInput['category'],
        coverImageUrl: editCoverImageUrl,
        status: formData.get('publish') ? 'published' : 'draft',
      }

      const res = await updateBlogPost(input)
      setEditResult(res)
      if (res.ok) {
        setEditOpen(false)
      }
    })
  }

  function handleDelete() {
    startTransition(async () => {
      await deleteBlogPost(id)
      setDeleteOpen(false)
    })
  }

  function handleToggleStatus() {
    const newStatus = status === 'published' ? 'draft' : 'published'
    startTransition(async () => {
      await updateBlogPost({ id, status: newStatus })
    })
  }

  async function handleImageUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return

    setIsUploading(true)
    try {
      const formData = new FormData()
      formData.set('file', file)
      formData.set('postId', id)
      const res = await uploadBlogCoverImage(formData)
      if (res.ok) {
        setEditCoverImageUrl(res.asset.url)
      }
    } finally {
      setIsUploading(false)
    }
  }

  return (
    <div className="flex items-center gap-2">
      <Button
        variant="outline"
        size="sm"
        disabled={isPending}
        onClick={handleToggleStatus}
      >
        {status === 'published' ? 'Unpublish' : 'Publish'}
      </Button>

      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogTrigger
          render={<Button variant="outline" size="sm" disabled={isPending} />}
        >
          Edit
        </DialogTrigger>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Edit Blog Post</DialogTitle>
            <DialogDescription>
              Update the blog post details. Slug is re-generated when the title changes.
            </DialogDescription>
          </DialogHeader>
          <form action={handleEdit} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor={`edit-title-${id}`}>Title</Label>
              <Input
                id={`edit-title-${id}`}
                name="title"
                defaultValue={title}
                required
                maxLength={300}
              />
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor={`edit-category-${id}`}>Category</Label>
                <Select value={editCategory} onValueChange={(v) => { if (v) setEditCategory(v) }}>
                  <SelectTrigger id={`edit-category-${id}`}>
                    <SelectValue placeholder="Select category" />
                  </SelectTrigger>
                  <SelectContent>
                    {BLOG_CATEGORIES.map((cat) => (
                      <SelectItem key={cat} value={cat}>
                        {cat.charAt(0).toUpperCase() + cat.slice(1)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor={`edit-cover-${id}`}>Cover Image</Label>
                <Input
                  id={`edit-cover-${id}`}
                  type="file"
                  accept="image/*"
                  onChange={handleImageUpload}
                  disabled={isUploading}
                />
                {isUploading && (
                  <p className="text-xs text-muted-foreground">Uploading...</p>
                )}
                {editCoverImageUrl && (
                  <p className="truncate text-xs text-success" role="status">
                    {editCoverImageUrl}
                  </p>
                )}
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor={`edit-excerpt-${id}`}>Excerpt</Label>
              <Textarea
                id={`edit-excerpt-${id}`}
                name="excerpt"
                defaultValue={excerpt ?? ''}
                maxLength={500}
                rows={2}
              />
            </div>

            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label htmlFor={`edit-content-${id}`}>
                  Content (Markdown)
                </Label>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setShowPreview((p) => !p)}
                >
                  {showPreview ? 'Edit' : 'Preview'}
                </Button>
              </div>
              {showPreview ? (
                <div className="prose prose-sm dark:prose-invert max-w-none rounded-md border p-4 min-h-[150px]">
                  <MarkdownPreview content={editContent} />
                </div>
              ) : (
                <Textarea
                  id={`edit-content-${id}`}
                  value={editContent}
                  onChange={(e) => setEditContent(e.target.value)}
                  rows={10}
                  className="font-mono text-sm"
                />
              )}
            </div>

            {editResult && !editResult.ok && (
              <p className="text-sm text-destructive" role="alert">
                {editResult.error}
              </p>
            )}

            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => setEditOpen(false)}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={isPending || isUploading}>
                {isPending ? 'Saving...' : 'Save as Draft'}
              </Button>
              <Button
                type="submit"
                name="publish"
                value="1"
                disabled={isPending || isUploading}
              >
                {isPending ? 'Publishing...' : 'Save & Publish'}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogTrigger
          render={
            <Button
              variant="outline"
              size="sm"
              disabled={isPending}
              className="text-destructive hover:text-destructive"
            />
          }
        >
          Delete
        </DialogTrigger>
        {/* DESIGN.md §4 A4: the destructive delete is consequential, so it never
            fires inline — it fires only from the explicit Confirm control inside
            this Dialog, which restates the permanent effect. Cancel is the
            non-default focus. English-only (admin). */}
        <DialogContent className="sm:max-w-md" data-testid="blog-delete-confirm">
          <DialogHeader>
            <DialogTitle>Delete blog post</DialogTitle>
            <DialogDescription>
              This permanently deletes &ldquo;{title}&rdquo;. The post is removed
              from the marketing site and cannot be recovered. Continue?
            </DialogDescription>
          </DialogHeader>

          <DialogFooter>
            <DialogClose render={<Button type="button" variant="outline" />}>
              Cancel
            </DialogClose>
            <Button
              type="button"
              variant="destructive"
              disabled={isPending}
              onClick={handleDelete}
            >
              {isPending ? 'Deleting…' : 'Delete post'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

// ── Simple Markdown Preview (shared with form) ─────────────────────

function MarkdownPreview({ content }: { content: string }) {
  if (!content.trim()) {
    return <p className="text-muted-foreground italic">Nothing to preview.</p>
  }

  const html = simpleMarkdownToHtml(content)
  return <div dangerouslySetInnerHTML={{ __html: html }} />
}

function simpleMarkdownToHtml(md: string): string {
  let html = md
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/```(\w*)\n([\s\S]*?)```/g, '<pre><code>$2</code></pre>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/^### (.+)$/gm, '<h3>$1</h3>')
    .replace(/^## (.+)$/gm, '<h2>$1</h2>')
    .replace(/^# (.+)$/gm, '<h1>$1</h1>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>')
    .replace(/^[*-] (.+)$/gm, '<li>$1</li>')
    .replace(/\n\n/g, '</p><p>')
    .replace(/\n/g, '<br>')

  if (!html.startsWith('<h') && !html.startsWith('<pre') && !html.startsWith('<li')) {
    html = `<p>${html}</p>`
  }

  return html
}
