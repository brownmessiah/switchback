'use client'

import Image from 'next/image'
import { useCallback, useRef, useState } from 'react'

import { Button } from '@/components/ui/button'

export interface UploadedImage {
  id: string
  url: string
  storageKey: string
}

interface ImageUploadProps {
  images: readonly UploadedImage[]
  onUpload: (file: File) => Promise<UploadedImage | null>
  onDelete: (id: string) => Promise<boolean>
  maxImages?: number
  disabled?: boolean
}

/**
 * Reusable drag-and-drop image upload component with preview and delete.
 * Stateless — the parent controls the image list and provides callbacks
 * for upload/delete that talk to the server actions.
 */
export function ImageUpload({
  images,
  onUpload,
  onDelete,
  maxImages = 10,
  disabled = false,
}: ImageUploadProps) {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [dragActive, setDragActive] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [deletingIds, setDeletingIds] = useState<Set<string>>(new Set())

  const handleFiles = useCallback(
    async (files: FileList | File[]) => {
      const fileArray = Array.from(files).filter((f) => f.type.startsWith('image/'))
      if (fileArray.length === 0) return

      const slotsAvailable = maxImages - images.length
      const toUpload = fileArray.slice(0, slotsAvailable)

      setUploading(true)
      for (const file of toUpload) {
        await onUpload(file)
      }
      setUploading(false)
    },
    [images.length, maxImages, onUpload],
  )

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      setDragActive(false)
      if (!disabled && e.dataTransfer.files.length > 0) {
        handleFiles(e.dataTransfer.files)
      }
    },
    [disabled, handleFiles],
  )

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setDragActive(true)
  }, [])

  const handleDragLeave = useCallback(() => {
    setDragActive(false)
  }, [])

  const handleDelete = useCallback(
    async (id: string) => {
      setDeletingIds((prev) => new Set([...prev, id]))
      await onDelete(id)
      setDeletingIds((prev) => {
        const next = new Set(prev)
        next.delete(id)
        return next
      })
    },
    [onDelete],
  )

  const atLimit = images.length >= maxImages

  return (
    <div className="space-y-4">
      {/* Drop zone */}
      {!atLimit && (
        <div
          role="button"
          tabIndex={0}
          aria-label="Drop images here or click to upload"
          className={`flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed p-8 transition-colors ${
            dragActive
              ? 'border-primary bg-primary/5'
              : 'border-muted-foreground/25 hover:border-muted-foreground/50'
          } ${disabled ? 'pointer-events-none opacity-50' : ''}`}
          onDrop={handleDrop}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onClick={() => fileInputRef.current?.click()}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault()
              fileInputRef.current?.click()
            }
          }}
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="24"
            height="24"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="mb-2 text-muted-foreground"
          >
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <polyline points="17 8 12 3 7 8" />
            <line x1="12" y1="3" x2="12" y2="15" />
          </svg>
          <p className="text-sm text-muted-foreground">
            {uploading ? 'Uploading...' : 'Drop images here or click to upload'}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            {images.length}/{maxImages} images
          </p>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            disabled={disabled}
            onChange={(e) => {
              if (e.target.files) handleFiles(e.target.files)
              e.target.value = '' // allow re-selecting the same file
            }}
          />
        </div>
      )}

      {/* Image grid */}
      {images.length > 0 && (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4">
          {images.map((img) => {
            const isDeleting = deletingIds.has(img.id)
            return (
              <div
                key={img.id}
                className="group relative aspect-square overflow-hidden rounded-lg border"
              >
                <Image
                  src={img.url}
                  alt=""
                  fill
                  className="object-cover"
                  sizes="(max-width: 640px) 50vw, (max-width: 768px) 33vw, 25vw"
                />
                <div className="absolute inset-0 flex items-start justify-end bg-black/0 p-2 transition-colors group-hover:bg-black/30">
                  <Button
                    type="button"
                    variant="destructive"
                    size="sm"
                    className="opacity-0 transition-opacity group-hover:opacity-100"
                    disabled={isDeleting}
                    onClick={() => handleDelete(img.id)}
                    aria-label="Delete image"
                  >
                    {isDeleting ? '...' : 'Delete'}
                  </Button>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
