'use client'

import { useRef, useState, useTransition } from 'react'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
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
  createBlogPost,
  uploadBlogCoverImage,
  type BlogActionResult,
  type CreateBlogPostInput,
} from './actions'

export function BlogPostCreateForm() {
  const formRef = useRef<HTMLFormElement>(null)
  const [isPending, startTransition] = useTransition()
  const [result, setResult] = useState<BlogActionResult | null>(null)
  const [category, setCategory] = useState<string>('guides')
  const [coverImageUrl, setCoverImageUrl] = useState<string | null>(null)
  const [isUploading, setIsUploading] = useState(false)
  const [content, setContent] = useState('')
  const [showPreview, setShowPreview] = useState(false)

  function handleSubmit(formData: FormData) {
    startTransition(async () => {
      const input: CreateBlogPostInput = {
        title: String(formData.get('title') ?? ''),
        content,
        excerpt: String(formData.get('excerpt') ?? '') || null,
        category: category as CreateBlogPostInput['category'],
        coverImageUrl: coverImageUrl,
        status: formData.get('publish') ? 'published' : 'draft',
      }

      const res = await createBlogPost(input)
      setResult(res)
      if (res.ok) {
        formRef.current?.reset()
        setContent('')
        setCoverImageUrl(null)
        setCategory('guides')
      }
    })
  }

  async function handleImageUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return

    setIsUploading(true)
    try {
      const formData = new FormData()
      formData.set('file', file)
      const res = await uploadBlogCoverImage(formData)
      if (res.ok) {
        setCoverImageUrl(res.asset.url)
      }
    } finally {
      setIsUploading(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="font-heading text-h3">Create Blog Post</CardTitle>
      </CardHeader>
      <CardContent>
        <form ref={formRef} action={handleSubmit} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="title">Title</Label>
              <Input
                id="title"
                name="title"
                placeholder="Top 10 Rafting Spots in Rishikesh"
                required
                maxLength={300}
              />
              <p className="text-xs text-muted-foreground">
                Slug is auto-generated from the title.
              </p>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="category">Category</Label>
              <Select value={category} onValueChange={(v) => { if (v) setCategory(v) }}>
                <SelectTrigger id="category">
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
              <Label htmlFor="coverImage">Cover Image</Label>
              <Input
                id="coverImage"
                type="file"
                accept="image/*"
                onChange={handleImageUpload}
                disabled={isUploading}
              />
              {isUploading && (
                <p className="text-xs text-muted-foreground">Uploading...</p>
              )}
              {coverImageUrl && (
                <p className="text-xs text-success" role="status">
                  Image uploaded.
                </p>
              )}
            </div>

            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="excerpt">Excerpt</Label>
              <Textarea
                id="excerpt"
                name="excerpt"
                placeholder="A short summary for listing pages..."
                maxLength={500}
                rows={2}
              />
            </div>

            <div className="space-y-1.5 sm:col-span-2">
              <div className="flex items-center justify-between">
                <Label htmlFor="content">Content (Markdown)</Label>
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
                <div className="prose prose-sm dark:prose-invert max-w-none rounded-md border p-4 min-h-[200px]">
                  <MarkdownPreview content={content} />
                </div>
              ) : (
                <Textarea
                  id="content"
                  value={content}
                  onChange={(e) => setContent(e.target.value)}
                  placeholder="# Your blog post&#10;&#10;Write your content in Markdown..."
                  rows={12}
                  className="font-mono text-sm"
                />
              )}
            </div>
          </div>

          {result && !result.ok && (
            <p className="text-sm text-destructive" role="alert">
              {result.error}
            </p>
          )}
          {result?.ok && (
            <p className="text-sm text-success" role="status">
              Blog post created.
            </p>
          )}

          <div className="flex gap-2">
            <Button type="submit" disabled={isPending || isUploading}>
              {isPending ? 'Creating...' : 'Save as Draft'}
            </Button>
            <Button
              type="submit"
              name="publish"
              value="1"
              variant="outline"
              disabled={isPending || isUploading}
            >
              {isPending ? 'Publishing...' : 'Save & Publish'}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  )
}

// ── Simple Markdown Preview ─────────────────────────────────────────

/**
 * A lightweight Markdown preview that handles headings, bold, italic,
 * links, lists, and code blocks. No external dependency needed for
 * the admin preview use-case.
 */
function MarkdownPreview({ content }: { content: string }) {
  if (!content.trim()) {
    return <p className="text-muted-foreground italic">Nothing to preview.</p>
  }

  const html = simpleMarkdownToHtml(content)
  return <div dangerouslySetInnerHTML={{ __html: html }} />
}

function simpleMarkdownToHtml(md: string): string {
  let html = md
    // Escape HTML
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    // Code blocks (triple backtick)
    .replace(/```(\w*)\n([\s\S]*?)```/g, '<pre><code>$2</code></pre>')
    // Inline code
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    // Headings
    .replace(/^### (.+)$/gm, '<h3>$1</h3>')
    .replace(/^## (.+)$/gm, '<h2>$1</h2>')
    .replace(/^# (.+)$/gm, '<h1>$1</h1>')
    // Bold and italic
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    // Links
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>')
    // Unordered lists
    .replace(/^[*-] (.+)$/gm, '<li>$1</li>')
    // Paragraphs (double newline)
    .replace(/\n\n/g, '</p><p>')
    // Single newlines within paragraphs
    .replace(/\n/g, '<br>')

  // Wrap in paragraph if not starting with a block element
  if (!html.startsWith('<h') && !html.startsWith('<pre') && !html.startsWith('<li')) {
    html = `<p>${html}</p>`
  }

  return html
}
