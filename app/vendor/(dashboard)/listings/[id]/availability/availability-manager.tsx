'use client'

import { useCallback, useEffect, useMemo, useState, useTransition } from 'react'
import {
  AlertTriangle,
  CalendarDays,
  Check,
  ChevronLeft,
  ChevronRight,
  Clock,
  Loader2,
  Lock,
  Plus,
  RefreshCw,
  Settings2,
  Trash2,
  Users,
  Wallet,
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
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  classifySlotStatus,
  type DerivedSlotStatus,
} from '@/lib/availability/manifest-helpers'

import {
  blockDateAction,
  createPatternAction,
  deletePatternAction,
  loadRegionClosures,
  loadSlotManifest,
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

interface ManifestEntry {
  bookingId: string
  slotId: string
  slotStartAt: Date
  slotEndAt: Date
  slotCapacity: number
  slotCapacityTaken: number
  participantCount: number
  bracket: '1-2' | '3-5' | '6+'
  state: string
  paymentMode: 'full_upfront' | 'partial_pay' | 'reserve_now_pay_later'
  balanceDueRupees: number
  customerName: string | null
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

function formatHm(d: Date): string {
  return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`
}

function formatInr(rupees: number): string {
  return `₹${rupees.toLocaleString('en-IN')}`
}

// Derive a day-level status from the most-urgent slot status on that day.
const STATUS_RANK: Record<DerivedSlotStatus, number> = {
  closed: 4,
  'sold-out': 3,
  'likely-sell-out': 2,
  open: 1,
}

interface StatusDisplay {
  label: string
  variant: 'success' | 'warning' | 'destructive' | 'secondary'
  Icon: typeof Check
}

const STATUS_DISPLAY: Record<DerivedSlotStatus, StatusDisplay> = {
  open: { label: 'Open', variant: 'success', Icon: Check },
  'likely-sell-out': { label: 'Likely to sell', variant: 'warning', Icon: Clock },
  'sold-out': { label: 'Sold out', variant: 'destructive', Icon: AlertTriangle },
  closed: { label: 'Closed', variant: 'secondary', Icon: Lock },
}

function dayStatus(slots: SlotData[], hasClosure: boolean): DerivedSlotStatus | null {
  if (hasClosure) return 'closed'
  if (slots.length === 0) return null
  let worst: DerivedSlotStatus = 'open'
  for (const s of slots) {
    const c = classifySlotStatus(s, false)
    if (STATUS_RANK[c] > STATUS_RANK[worst]) worst = c
  }
  return worst
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
  const [manifest, setManifest] = useState<ManifestEntry[]>([])
  const [isPending, startTransition] = useTransition()
  const [message, setMessage] = useState<string | null>(null)

  // View toggle (B6 calendar ⇄ manifest)
  const [view, setView] = useState<'calendar' | 'manifest'>('calendar')

  // Day-detail Sheet
  const [openDay, setOpenDay] = useState<string | null>(null)

  // Calendar state
  const now = new Date()
  const [calYear, setCalYear] = useState(now.getUTCFullYear())
  const [calMonth, setCalMonth] = useState(now.getUTCMonth())

  // Rule editor (patterns demoted to a secondary, collapsible rule panel
  // BELOW the calendar so the calendar is the center of gravity). Open by
  // default so the weekly-pattern controls are reachable; the Vendor can
  // collapse it to give the calendar the full surface.
  const [rulesOpen, setRulesOpen] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [newDayOfWeek, setNewDayOfWeek] = useState('1')
  const [newStartTime, setNewStartTime] = useState('06:00')
  const [newEndTime, setNewEndTime] = useState('09:00')
  const [newCapacity, setNewCapacity] = useState('10')
  const [newEffectiveFrom, setNewEffectiveFrom] = useState('')
  const [newEffectiveUntil, setNewEffectiveUntil] = useState('')

  // Load slots, closures, and the Booking manifest for the current month.
  const loadCalendarData = useCallback(() => {
    startTransition(async () => {
      const [slotsData, closuresData, manifestData] = await Promise.all([
        loadSlotsForMonth(experienceId, calYear, calMonth),
        loadRegionClosures(regionSlug, calYear, calMonth),
        loadSlotManifest(experienceId, calYear, calMonth),
      ])
      setSlots(slotsData as SlotData[])
      setClosures(closuresData as ClosureData[])
      setManifest(manifestData as ManifestEntry[])
    })
  }, [experienceId, regionSlug, calYear, calMonth])

  useEffect(() => {
    loadCalendarData()
  }, [loadCalendarData])

  // Group slots by date
  const slotsByDate = useMemo(() => {
    const map = new Map<string, SlotData[]>()
    for (const slot of slots) {
      const key = formatDateKey(slot.startAt)
      const existing = map.get(key) ?? []
      map.set(key, [...existing, slot])
    }
    return map
  }, [slots])

  // Group manifest entries by slot (for the roster + day-detail roster).
  const manifestBySlot = useMemo(() => {
    const map = new Map<string, ManifestEntry[]>()
    for (const e of manifest) {
      const existing = map.get(e.slotId) ?? []
      map.set(e.slotId, [...existing, e])
    }
    return map
  }, [manifest])

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

  for (let i = 0; i < firstDay; i++) {
    calendarCells.push({ date: null, dateStr: '', slots: [], closure: undefined })
  }

  for (let d = 1; d <= daysInMonth; d++) {
    const dateStr = `${calYear}-${String(calMonth + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`
    const daySlots = slotsByDate.get(dateStr) ?? []
    const closure = isDateInClosure(dateStr, closures)
    calendarCells.push({ date: d, dateStr, slots: daySlots, closure })
  }

  // Day-detail data for the open Sheet.
  const openCell = openDay
    ? {
        dateStr: openDay,
        slots: slotsByDate.get(openDay) ?? [],
        closure: isDateInClosure(openDay, closures),
      }
    : null

  // Upcoming slots in this month that have a roster (for the Manifest view),
  // ordered by start time.
  const rosterSlots = useMemo(() => {
    const seen = new Map<string, SlotData>()
    for (const s of slots) {
      if (manifestBySlot.has(s.id)) seen.set(s.id, s)
    }
    return [...seen.values()].sort((a, b) => a.startAt.getTime() - b.startAt.getTime())
  }, [slots, manifestBySlot])

  return (
    <div className="space-y-6">
      {/* View toggle + rule-editor entry (calendar is the center of gravity) */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Tabs
          value={view}
          onValueChange={(v) => setView(v as 'calendar' | 'manifest')}
          data-testid="availability-view-toggle"
        >
          <TabsList>
            <TabsTrigger value="calendar" data-testid="view-tab-calendar">
              <CalendarDays className="size-4" />
              Calendar
            </TabsTrigger>
            <TabsTrigger value="manifest" data-testid="view-tab-manifest">
              <Users className="size-4" />
              Manifest / Roster
            </TabsTrigger>
          </TabsList>
        </Tabs>
        <Button
          variant="outline"
          size="sm"
          onClick={() => setRulesOpen((o) => !o)}
          data-testid="manage-rules-toggle"
        >
          <Settings2 className="size-4" />
          Weekly Patterns
        </Button>
      </div>

      {/* Status message */}
      {message && (
        <div className="flex items-center justify-between rounded-lg border border-border bg-muted/50 p-3 text-sm">
          <span>{message}</span>
          <button onClick={() => setMessage(null)} className="min-tap text-muted-foreground hover:text-foreground" aria-label="Dismiss message">
            <X className="size-4" />
          </button>
        </div>
      )}

      {/* ── CALENDAR VIEW ─────────────────────────────────────────── */}
      {view === 'calendar' && (
        <Card>
          <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
            {/* Heading omitted — the "Calendar" Tab labels this view (avoids a
                duplicate "Calendar" text match). Month navigation only. */}
            <CardTitle className="text-base">Month view</CardTitle>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="icon-sm" onClick={prevMonth}>
                <ChevronLeft className="size-4" />
              </Button>
              <span className="min-w-[140px] text-center text-sm font-medium tabular-nums">
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
                {/* Legend — semantic status, color + icon (DESIGN.md §1.3) */}
                <div className="mb-4 flex flex-wrap gap-3 text-xs">
                  {(['open', 'likely-sell-out', 'sold-out', 'closed'] as const).map((s) => {
                    const d = STATUS_DISPLAY[s]
                    return (
                      <span key={s} className="flex items-center gap-1">
                        <Badge variant={d.variant} className="gap-1">
                          <d.Icon className="size-3" aria-hidden />
                          {d.label}
                        </Badge>
                      </span>
                    )
                  })}
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
                      return <div key={`empty-${idx}`} className="min-h-[88px]" />
                    }

                    const hasSlots = cell.slots.length > 0
                    const hasClosure = !!cell.closure
                    const status = dayStatus(cell.slots, hasClosure)
                    const allClosed = hasSlots && cell.slots.every((s) => s.status === 'closed')

                    const totalCapacity = cell.slots.reduce((sum, s) => sum + s.capacity, 0)
                    const totalTaken = cell.slots.reduce((sum, s) => sum + s.capacityTaken, 0)
                    const remaining = totalCapacity - totalTaken

                    let ringClass = 'ring-border'
                    if (status === 'closed') ringClass = 'ring-border bg-muted/40'
                    else if (status === 'sold-out') ringClass = 'ring-destructive/30 bg-destructive-subtle/40'
                    else if (status === 'likely-sell-out') ringClass = 'ring-warning/30 bg-warning-subtle/40'
                    else if (status === 'open') ringClass = 'ring-success/30 bg-success-subtle/30'

                    const display = status ? STATUS_DISPLAY[status] : null

                    return (
                      // Day cell kept as a <div> (with <div><span>{n}</span></div>
                      // inside) so the block/unblock E2E cell selector
                      // `div:has(> div > span:text-is("N"))` resolves. Clickable
                      // for the day-detail Sheet; keyboard-accessible via role.
                      <div
                        key={cell.dateStr}
                        role="button"
                        tabIndex={0}
                        onClick={() => setOpenDay(cell.dateStr)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault()
                            setOpenDay(cell.dateStr)
                          }
                        }}
                        data-testid={`calendar-day-${cell.dateStr}`}
                        className={`group relative flex min-h-[88px] cursor-pointer flex-col rounded-md p-1.5 text-left text-xs ring-1 transition-colors hover:bg-muted/60 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none ${ringClass}`}
                      >
                        <div className="flex items-start justify-between">
                          <span className="font-medium tabular-nums">{cell.date}</span>
                          {hasSlots && !hasClosure && (
                            <span className="hidden gap-0.5 group-hover:flex">
                              {allClosed ? (
                                <button
                                  type="button"
                                  onClick={(e) => { e.stopPropagation(); handleUnblockDate(cell.dateStr) }}
                                  className="rounded p-0.5 text-2xs text-success hover:bg-success-subtle"
                                  title="Unblock date"
                                >
                                  Unblock
                                </button>
                              ) : (
                                <button
                                  type="button"
                                  onClick={(e) => { e.stopPropagation(); handleBlockDate(cell.dateStr) }}
                                  className="rounded p-0.5 text-2xs text-destructive hover:bg-destructive/10"
                                  title="Block date"
                                >
                                  Block
                                </button>
                              )}
                            </span>
                          )}
                        </div>

                        {hasClosure && (
                          <div className="mt-1 flex items-center gap-1 text-warning">
                            <Lock className="size-3 shrink-0" aria-hidden />
                            <span className="truncate">{cell.closure!.reason}</span>
                          </div>
                        )}

                        {hasSlots && !hasClosure && display && (
                          <div className="mt-1 space-y-1">
                            <Badge variant={display.variant} className="gap-1 px-1.5 py-0">
                              <display.Icon className="size-2.5" aria-hidden />
                              {status === 'open' ? `${remaining} spots` : display.label}
                            </Badge>
                            {status !== 'open' && remaining > 0 && (
                              <div className="text-2xs text-muted-foreground tabular-nums">
                                {remaining} left
                              </div>
                            )}
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
      )}

      {/* ── MANIFEST / ROSTER VIEW ────────────────────────────────── */}
      {view === 'manifest' && (
        <Card data-testid="manifest-view">
          <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
            <CardTitle className="flex items-center gap-2">
              <Users className="size-5" />
              Run-of-day manifest
            </CardTitle>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="icon-sm" onClick={prevMonth}>
                <ChevronLeft className="size-4" />
              </Button>
              <span className="min-w-[140px] text-center text-sm font-medium tabular-nums">
                {MONTH_NAMES[calMonth]} {calYear}
              </span>
              <Button variant="outline" size="icon-sm" onClick={nextMonth}>
                <ChevronRight className="size-4" />
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {isPending && (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="size-6 animate-spin text-muted-foreground" />
              </div>
            )}

            {!isPending && rosterSlots.length === 0 && (
              <div className="flex flex-col items-center justify-center py-12 text-center">
                <div className="mb-3 flex size-12 items-center justify-center rounded-full bg-muted">
                  <Users className="size-6 text-muted-foreground" aria-hidden />
                </div>
                <p className="text-lg font-medium">No bookings this month</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Bookings on your slots will appear here as a run-of-day roster.
                </p>
              </div>
            )}

            {!isPending &&
              rosterSlots.map((slot) => (
                <ManifestSlotCard
                  key={slot.id}
                  slot={slot}
                  entries={manifestBySlot.get(slot.id) ?? []}
                />
              ))}
          </CardContent>
        </Card>
      )}

      {/* Rule editor — demoted weekly-pattern panel BELOW the calendar so the
          calendar stays the center of gravity (folds C's rule editor). */}
      {rulesOpen && (
        <Card data-testid="rules-editor">
          <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
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
                    <span className="text-sm font-medium tabular-nums">
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

            {showForm && (
              <div className="rounded-lg border border-dashed border-border p-4 space-y-4">
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
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
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
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
      )}

      {/* ── DAY-DETAIL SHEET ──────────────────────────────────────── */}
      <Sheet open={openDay !== null} onOpenChange={(o) => { if (!o) setOpenDay(null) }}>
        <SheetContent data-testid="day-detail-sheet">
          <SheetHeader>
            <SheetTitle>{openDay ? `Day detail — ${openDay}` : 'Day detail'}</SheetTitle>
            <SheetDescription>
              {view === 'manifest'
                ? 'Slots and roster for this day.'
                : 'Slots and capacity for this day.'}
            </SheetDescription>
          </SheetHeader>
          <div className="flex-1 space-y-3 overflow-y-auto px-4 pb-4">
            {openCell?.closure && (
              <div className="flex items-center gap-2 rounded-md bg-warning-subtle p-3 text-warning">
                <Lock className="size-4 shrink-0" aria-hidden />
                <span className="text-sm">{openCell.closure.reason}</span>
              </div>
            )}

            {openCell && openCell.slots.length === 0 && !openCell.closure && (
              <p className="text-sm text-muted-foreground">No slots on this day.</p>
            )}

            {openCell?.slots.map((slot) => {
              const status = classifySlotStatus(slot, !!openCell.closure)
              const d = STATUS_DISPLAY[status]
              const entries = manifestBySlot.get(slot.id) ?? []
              return (
                <div key={slot.id} className="rounded-lg border border-border p-3">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium tabular-nums">
                      {formatHm(slot.startAt)}–{formatHm(slot.endAt)}
                    </span>
                    <Badge variant={d.variant} className="gap-1">
                      <d.Icon className="size-3" aria-hidden />
                      {d.label}
                    </Badge>
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground tabular-nums">
                    {slot.capacityTaken}/{slot.capacity} booked
                  </div>

                  {/* Roster (manifest mode) — who's coming on this slot */}
                  {view === 'manifest' && entries.length > 0 && (
                    <div className="mt-2 space-y-1 border-t border-border pt-2">
                      {entries.map((e) => (
                        <RosterRow key={e.bookingId} entry={e} />
                      ))}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </SheetContent>
      </Sheet>
    </div>
  )
}

// ── Manifest sub-components ─────────────────────────────────────────

function ManifestSlotCard({ slot, entries }: { slot: SlotData; entries: ManifestEntry[] }) {
  const status = classifySlotStatus(slot, false)
  const d = STATUS_DISPLAY[status]
  const totalParticipants = entries.reduce((sum, e) => sum + e.participantCount, 0)
  const balanceOwed = entries.reduce((sum, e) => sum + e.balanceDueRupees, 0)
  // Booking cutoff: the Partial-pay balance auto-captures at T-24h before
  // departure (ADR-0001); after that point new partial-pay bookings close.
  const cutoffAt = new Date(slot.startAt.getTime() - 24 * 60 * 60 * 1000)

  return (
    <div className="rounded-lg border border-border p-4" data-testid="manifest-slot">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium tabular-nums">
            {formatDateKey(slot.startAt)} · {formatHm(slot.startAt)}–{formatHm(slot.endAt)}
          </span>
          <Badge variant={d.variant} className="gap-1">
            <d.Icon className="size-3" aria-hidden />
            {d.label}
          </Badge>
        </div>
        <span className="text-xs text-muted-foreground tabular-nums">
          {slot.capacityTaken}/{slot.capacity} seats
        </span>
      </div>

      {/* Booking-cutoff banner (T-24h balance auto-capture) */}
      <div className="mt-2 flex items-center gap-1.5 rounded-md bg-info-subtle px-2.5 py-1.5 text-xs text-info">
        <Clock className="size-3.5 shrink-0" aria-hidden />
        <span className="tabular-nums">
          Booking cutoff (Partial-pay balance auto-captured): {formatDateKey(cutoffAt)} {formatHm(cutoffAt)}
        </span>
      </div>

      <div className="mt-3 space-y-1">
        {entries.map((e) => (
          <RosterRow key={e.bookingId} entry={e} />
        ))}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-3 border-t border-border pt-2 text-xs text-muted-foreground">
        <span className="flex items-center gap-1 tabular-nums">
          <Users className="size-3.5" aria-hidden /> {totalParticipants} participant
          {totalParticipants === 1 ? '' : 's'}
        </span>
        {balanceOwed > 0 && (
          <span className="flex items-center gap-1 text-warning tabular-nums" data-testid="slot-balance-owed">
            <Wallet className="size-3.5" aria-hidden /> {formatInr(balanceOwed)} balance due
          </span>
        )}
      </div>
    </div>
  )
}

function RosterRow({ entry }: { entry: ManifestEntry }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 text-sm" data-testid="roster-row">
      <div className="flex items-center gap-2">
        <span className="font-medium">{entry.customerName ?? 'Guest'}</span>
        <Badge variant="secondary" className="tabular-nums">
          {entry.participantCount} pax · {entry.bracket}
        </Badge>
      </div>
      {entry.paymentMode === 'partial_pay' && entry.balanceDueRupees > 0 ? (
        <span className="flex items-center gap-1 text-xs text-warning tabular-nums">
          <Wallet className="size-3" aria-hidden /> {formatInr(entry.balanceDueRupees)} due
        </span>
      ) : (
        <span className="flex items-center gap-1 text-xs text-success">
          <Check className="size-3" aria-hidden /> Paid in full
        </span>
      )}
    </div>
  )
}
