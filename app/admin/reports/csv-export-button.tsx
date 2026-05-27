'use client'

import { useState } from 'react'

import { Button } from '@/components/ui/button'

interface CsvExportButtonProps {
  readonly entity: 'users' | 'vendors' | 'bookings' | 'experiences'
  readonly label: string
}

export function CsvExportButton({ entity, label }: CsvExportButtonProps) {
  const [loading, setLoading] = useState(false)

  async function handleExport() {
    setLoading(true)
    try {
      const res = await fetch(`/admin/reports/csv?entity=${entity}`)
      if (!res.ok) throw new Error('Export failed')

      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${entity}-export-${new Date().toISOString().slice(0, 10)}.csv`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
    } finally {
      setLoading(false)
    }
  }

  return (
    <Button variant="outline" size="sm" onClick={handleExport} disabled={loading}>
      {loading ? 'Exporting...' : label}
    </Button>
  )
}
