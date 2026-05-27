'use client'

import { useCallback, useEffect, useState, useTransition } from 'react'
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Loader2,
  Plus,
  RefreshCw,
  Trash2,
  X,
} from 'lucide-react'

import { Badge } from '@/components/ui/badge'
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

import {
  blockDateAction,
  createPatternAction,
  deletePatternAction,
  loadRegionClosures,
  loadSlotsForMonth,
  materializeSlotsAction,
  unblockDateAction,
} from './actions'

// ── Types ─────────────────────────────────────────────────────────

interface PatternData {
  id: string
  dayOfWeek: number
  startTime: string
  endTime: string
  capacity: number
  effectiveFrom: string | null
  effectiveUntil: string | null
}

interface SlotData {
  id: string
  startAt: Date
  endAt: Date
  capacity: number
  capacityTaken: number
  status: 'open' | 'sold_out' | 'closed'
}

interface ClosureData {
  id: string
  startAt: Date
  endAt: Date
  reason: string
  source: 'admin' | 'vendor'
}

interface AvailabilityManagerProps {
  experienceId: string
  regionSlug: string
  initialPatterns: PatternData[]
}

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const DAY_ABBREVS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

// ── Helpers ───────────────────────────────────────────────────────

function formatDateKey(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`
}

function getDaysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month + 1, 0)).getUTCDate()
}

function getFirstDayOfMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 1)).getUTCDay()
}

function isDateInClosure(dateStr: string, closures: ClosureData[]): ClosureData | undefined {
  const dayStart = new Date(`${dateStr}T00:00:00.000Z`)
  const dayEnd = new Date(`${dateStr}T23:59:59.999Z`)
  return closures.find((c) => dayStart < c.endAt && dayEnd > c.startAt)
}

// ── Component ─────────────────────────────────────────────────────

export function AvailabilityManager({
  experienceId,
  regionSlug,
  initialPatterns,
}: AvailabilityManagerProps) {
  const [patterns, setPatterns] = useState<PatternData[]>(initialPatterns)
  const [slots, setSlots] = useState<SlotData[]>([])
  const [closures, setClosures] = useState<ClosureData[]>([])
  const [isPending, startTransition] = useTransition()
  const [message, setMessage] = useState<string | null>(null)

  // Calendar state
  const now = new Date()
  const [calYear, setCalYear] = useState(now.getUTCFullYear())
  const [calMonth, setCalMonth] = useState(now.getUTCMonth())

  // New pattern form state
  const [showForm, setShowForm] = useState(false)
  const [newDayOfWeek, setNewDayOfWeek] = useState('1')
  const [newStartTime, setNewStartTime] = useState('06:00')
  const [newEndTime, setNewEndTime] = useState('09:00')
  const [newCapacity, setNewCapacity] = useState('10')
  const [newEffectiveFrom, setNewEffectiveFrom] = useState('')
  const [newEffectiveUntil, setNewEffectiveUntil] = useState('')

  // Load slots and closures for the current month
  const loadCalendarData = useCallback(() => {
    startTransition(async () => {
      const [slotsData, closuresData] = await Promise.all([
        loadSlotsForMonth(experienceId, calYear, calMonth),
        loadRegionClosures(regionSlug, calYear, calMonth),
      ])
      setSlots(slotsData as SlotData[])
      setClosures(closuresData as ClosureData[])
    })
  }, [experienceId, regionSlug, calYear, calMonth])

  useEffect(() => {
    loadCalendarData()
  }, [loadCalendarData])

  // Group slots by date
  const slotsByDate = new Map<string, SlotData[]>()
  for (const slot of slots) {
    const key = formatDateKey(slot.startAt)
    const existing = slotsByDate.get(key) ?? []
    slotsByDate.set(key, [...existing, slot])
  }

  // ── Pattern actions ───────────────────────────────────────────

  function handleCreatePattern() {
    startTransition(async () => {
      const result = await createPatternAction({
        experienceId,
        dayOfWeek: parseInt(newDayOfWeek, 10),
        startTime: newStartTime,
        endTime: newEndTime,
        capacity: parseInt(newCapacity, 10),
        effectiveFrom: newEffectiveFrom || null,
        effectiveUntil: newEffectiveUntil || null,
      })

      if (result.ok) {
        setPatterns((prev) => [
          ...prev,
          {
            id: result.pattern.id,
            dayOfWeek: result.pattern.dayOfWeek,
            startTime: result.pattern.startTime,
            endTime: result.pattern.endTime,
            capacity: result.pattern.capacity,
            effectiveFrom: result.pattern.effectiveFrom,
            effectiveUntil: result.pattern.effectiveUntil,
          },
        ])
        setShowForm(false)
        setMessage('Pattern created.')
      } else {
        setMessage(result.error)
      }
    })
  }

  function handleDeletePattern(patternId: string) {
    startTransition(async () => {
      const result = await deletePatternAction(patternId)
      if (result.ok) {
        setPatterns((prev) => prev.filter((p) => p.id !== patternId))
        setMessage('Pattern deleted.')
      } else {
        setMessage(result.error)
      }
    })
  }

  function handleMaterialize() {
    startTransition(async () => {
      const result = await materializeSlotsAction(experienceId)
      if (result.ok) {
        setMessage(`Slots generated: ${result.created} created, ${result.skipped} already existed.`)
        loadCalendarData()
      } else {
        setMessage(result.error)
      }
    })
  }

  function handleBlockDate(dateStr: string) {
    startTransition(async () => {
      const result = await blockDateAction(experienceId, dateStr)
      if (result.ok) {
        setMessage(`Blocked ${dateStr}: ${result.affected} slot(s) closed.`)
        loadCalendarData()
      } else {
        setMessage(result.error)
      }
    })
  }

  function handleUnblockDate(dateStr: string) {
    startTransition(async () => {
      const result = await unblockDateAction(experienceId, dateStr)
      if (result.ok) {
        setMessage(`Unblocked ${dateStr}: ${result.affected} slot(s) reopened.`)
        loadCalendarData()
      } else {
        setMessage(result.error)
      }
    })
  }

  // ── Calendar navigation ───────────────────────────────────────

  function prevMonth() {
    if (calMonth === 0) {
      setCalYear((y) => y - 1)
      setCalMonth(11)
    } else {
      setCalMonth((m) => m - 1)
    }
  }

  function nextMonth() {
    if (calMonth === 11) {
      setCalYear((y) => y + 1)
      setCalMonth(0)
    } else {
      setCalMonth((m) => m + 1)
    }
  }

  // ── Render calendar grid ──────────────────────────────────────

  const daysInMonth = getDaysInMonth(calYear, calMonth)
  const firstDay = getFirstDayOfMonth(calYear, calMonth)

  const calendarCells: Array<{
    date: number | null
    dateStr: string
    slots: SlotData[]
    closure: ClosureData | undefined
  }> = []

  // Leading empty cells
  for (let i = 0; i < firstDay; i++) {
    calendarCells.push({ date: null, dateStr: '', slots: [], closure: undefined })
  }

  // Day cells
  for (let d = 1; d <= daysInMonth; d++) {
    const dateStr = `${calYear}-${String(calMonth + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`
    const daySlots = slotsByDate.get(dateStr) ?? []
    const closure = isDateInClosure(dateStr, closures)
    calendarCells.push({ date: d, dateStr, slots: daySlots, closure })
  }

  return (
    <div className="space-y-6">
      {/* Status message */}
      {message && (
        <div className="flex items-center justify-between rounded-lg border border-border bg-muted/50 p-3 text-sm">
          <span>{message}</span>
          <button onClick={() => setMessage(null)} className="text-muted-foreground hover:text-foreground">
            <X className="size-4" />
          </button>
        </div>
      )}

      {/* Patterns section */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <CalendarDays className="size-5" />
            Weekly Patterns
          </CardTitle>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={handleMaterialize} disabled={isPending}>
              {isPending ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
              Generate Slots
            </Button>
            <Button size="sm" onClick={() => setShowForm(!showForm)}>
              <Plus className="size-4" />
              Add Pattern
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Existing patterns */}
          {patterns.length === 0 && !showForm && (
            <p className="text-sm text-muted-foreground">
              No patterns configured. Add a weekly pattern to start generating availability slots.
            </p>
          )}

          {patterns.map((pattern) => (
            <div
              key={pattern.id}
              className="flex items-center justify-between rounded-lg border border-border p-3"
            >
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <Badge variant="secondary">{DAY_NAMES[pattern.dayOfWeek]}</Badge>
                  <span className="text-sm font-medium">
                    {pattern.startTime} &ndash; {pattern.endTime}
                  </span>
                  <Badge variant="outline">{pattern.capacity} spots</Badge>
                </div>
                {(pattern.effectiveFrom || pattern.effectiveUntil) && (
                  <p className="text-xs text-muted-foreground">
                    {pattern.effectiveFrom && `From ${pattern.effectiveFrom}`}
                    {pattern.effectiveFrom && pattern.effectiveUntil && ' '}
                    {pattern.effectiveUntil && `Until ${pattern.effectiveUntil}`}
                  </p>
                )}
              </div>
              <Button
                variant="destructive"
                size="icon-sm"
                onClick={() => handleDeletePattern(pattern.id)}
                disabled={isPending}
              >
                <Trash2 className="size-3.5" />
              </Button>
            </div>
          ))}

          {/* New pattern form */}
          {showForm && (
            <div className="rounded-lg border border-dashed border-border p-4 space-y-4">
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                <div className="space-y-1.5">
                  <Label htmlFor="dayOfWeek">Day</Label>
                  <Select value={newDayOfWeek} onValueChange={(v) => { if (v !== null) setNewDayOfWeek(v) }}>
                    <SelectTrigger id="dayOfWeek">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {DAY_NAMES.map((name, i) => (
                        <SelectItem key={i} value={String(i)}>
                          {name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="startTime">Start Time</Label>
                  <Input
                    id="startTime"
                    type="time"
                    value={newStartTime}
                    onChange={(e) => setNewStartTime(e.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="endTime">End Time</Label>
                  <Input
                    id="endTime"
                    type="time"
                    value={newEndTime}
                    onChange={(e) => setNewEndTime(e.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="capacity">Capacity</Label>
                  <Input
                    id="capacity"
                    type="number"
                    min={1}
                    value={newCapacity}
                    onChange={(e) => setNewCapacity(e.target.value)}
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label htmlFor="effectiveFrom">Effective From (optional)</Label>
                  <Input
                    id="effectiveFrom"
                    type="date"
                    value={newEffectiveFrom}
                    onChange={(e) => setNewEffectiveFrom(e.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="effectiveUntil">Effective Until (optional)</Label>
                  <Input
                    id="effectiveUntil"
                    type="date"
                    value={newEffectiveUntil}
                    onChange={(e) => setNewEffectiveUntil(e.target.value)}
                  />
                </div>
              </div>
              <div className="flex gap-2">
                <Button size="sm" onClick={handleCreatePattern} disabled={isPending}>
                  {isPending && <Loader2 className="size-4 animate-spin" />}
                  Save Pattern
                </Button>
                <Button variant="outline" size="sm" onClick={() => setShowForm(false)}>
                  Cancel
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Calendar section */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Calendar</CardTitle>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="icon-sm" onClick={prevMonth}>
              <ChevronLeft className="size-4" />
            </Button>
            <span className="min-w-[140px] text-center text-sm font-medium">
              {MONTH_NAMES[calMonth]} {calYear}
            </span>
            <Button variant="outline" size="icon-sm" onClick={nextMonth}>
              <ChevronRight className="size-4" />
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {isPending && (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="size-6 animate-spin text-muted-foreground" />
            </div>
          )}

          {!isPending && (
            <>
              {/* Legend */}
              <div className="mb-4 flex flex-wrap gap-3 text-xs">
                <span className="flex items-center gap-1">
                  <span className="inline-block size-3 rounded-sm bg-emerald-500/20 ring-1 ring-emerald-500/30" />
                  Open
                </span>
                <span className="flex items-center gap-1">
                  <span className="inline-block size-3 rounded-sm bg-blue-500/20 ring-1 ring-blue-500/30" />
                  Has Bookings
                </span>
                <span className="flex items-center gap-1">
                  <span className="inline-block size-3 rounded-sm bg-amber-500/20 ring-1 ring-amber-500/30" />
                  Sold Out
                </span>
                <span className="flex items-center gap-1">
                  <span className="inline-block size-3 rounded-sm bg-red-500/20 ring-1 ring-red-500/30" />
                  Blocked
                </span>
                <span className="flex items-center gap-1">
                  <span className="inline-block size-3 rounded-sm bg-purple-500/20 ring-1 ring-purple-500/30" />
                  Region Closure
                </span>
              </div>

              {/* Day headers */}
              <div className="grid grid-cols-7 gap-1">
                {DAY_ABBREVS.map((day) => (
                  <div key={day} className="py-1 text-center text-xs font-medium text-muted-foreground">
                    {day}
                  </div>
                ))}

                {/* Calendar cells */}
                {calendarCells.map((cell, idx) => {
                  if (cell.date === null) {
                    return <div key={`empty-${idx}`} className="min-h-[80px]" />
                  }

                  const hasSlots = cell.slots.length > 0
                  const hasBookings = cell.slots.some((s) => s.capacityTaken > 0)
                  const allClosed = hasSlots && cell.slots.every((s) => s.status === 'closed')
                  const anySoldOut = cell.slots.some((s) => s.status === 'sold_out')
                  const hasClosure = !!cell.closure

                  let bgClass = 'bg-background'
                  if (hasClosure) bgClass = 'bg-purple-500/10 ring-1 ring-purple-500/20'
                  else if (allClosed) bgClass = 'bg-red-500/10 ring-1 ring-red-500/20'
                  else if (anySoldOut) bgClass = 'bg-amber-500/10 ring-1 ring-amber-500/20'
                  else if (hasBookings) bgClass = 'bg-blue-500/10 ring-1 ring-blue-500/20'
                  else if (hasSlots) bgClass = 'bg-emerald-500/10 ring-1 ring-emerald-500/20'

                  const totalCapacity = cell.slots.reduce((sum, s) => sum + s.capacity, 0)
                  const totalBooked = cell.slots.reduce((sum, s) => sum + s.capacityTaken, 0)

                  return (
                    <div
                      key={cell.dateStr}
                      className={`group relative min-h-[80px] rounded-md p-1.5 text-xs ${bgClass} transition-colors`}
                    >
                      <div className="flex items-start justify-between">
                        <span className="font-medium">{cell.date}</span>
                        {hasSlots && !hasClosure && (
                          <div className="hidden group-hover:flex gap-0.5">
                            {allClosed ? (
                              <button
                                onClick={() => handleUnblockDate(cell.dateStr)}
                                className="rounded p-0.5 text-xs text-emerald-600 hover:bg-emerald-500/20"
                                title="Unblock date"
                              >
                                Unblock
                              </button>
                            ) : (
                              <button
                                onClick={() => handleBlockDate(cell.dateStr)}
                                className="rounded p-0.5 text-xs text-red-600 hover:bg-red-500/20"
                                title="Block date"
                              >
                                Block
                              </button>
                            )}
                          </div>
                        )}
                      </div>

                      {hasClosure && (
                        <div className="mt-1 truncate text-purple-700 dark:text-purple-400">
                          {cell.closure!.reason}
                        </div>
                      )}

                      {hasSlots && !hasClosure && (
                        <div className="mt-1 space-y-0.5">
                          {cell.slots.map((slot) => (
                            <div
                              key={slot.id}
                              className="truncate"
                              title={`${slot.startAt.getUTCHours()}:${String(slot.startAt.getUTCMinutes()).padStart(2, '0')} — ${slot.capacityTaken}/${slot.capacity} booked`}
                            >
                              <span className="font-mono">
                                {String(slot.startAt.getUTCHours()).padStart(2, '0')}:
                                {String(slot.startAt.getUTCMinutes()).padStart(2, '0')}
                              </span>
                              {' '}
                              <span className={slot.capacityTaken > 0 ? 'text-blue-600 dark:text-blue-400' : 'text-muted-foreground'}>
                                {slot.capacityTaken}/{slot.capacity}
                              </span>
                            </div>
                          ))}
                        </div>
                      )}

                      {!hasSlots && !hasClosure && (
                        <div className="mt-1 text-muted-foreground/50">&mdash;</div>
                      )}
                    </div>
                  )
                })}
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
