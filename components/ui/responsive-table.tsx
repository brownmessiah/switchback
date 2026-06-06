import type { ReactNode } from "react"
import Link from "next/link"

import { Card, CardContent } from "@/components/ui/card"
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { cn } from "@/lib/utils"

/**
 * `<ResponsiveTable>` — the shared A3-reversal table wrapper (DESIGN.md §8.5
 * item 2; ADR-0018). One config drives two renderings:
 *
 *  - **`≥ md`**: the existing `Table` primitive (sortable-head / bulk-select
 *    semantics, where a surface needs them, still live on the table) inside the
 *    A3 `Card > CardContent p-0` shell; horizontal-scroll survives here only as
 *    the tablet/desktop fallback (DESIGN.md §8.7).
 *  - **`< md`**: a stacked `label: value` Card list — each row becomes one Card
 *    titled by its `primary` column (a row-link when `rowHref` is given); every
 *    other column renders as a `header: value` pair. Right-aligned numerics keep
 *    `.tabular-nums`; status cells keep their `Badge` via the column `cell()`.
 *
 * The md/below-md switch is `hidden md:block` / `md:hidden` so exactly one
 * rendering is in the a11y tree at a time — no duplicate interactive controls.
 *
 * `ResponsiveTable` OWNS its `≥ md` `Card > CardContent p-0` shell — consumers
 * replace the whole `<Card><CardContent p-0><Table>…</Table></CardContent></Card>`
 * block with this component and must NOT wrap it in another `Card` (a nested
 * card-in-card at `≥ md` is the bug this guards against).
 *
 * Consumed by the ~24 admin/vendor A3/B6 tables in the per-surface sweep, so the
 * API is deliberately ergonomic: a generic row type, per-column `cell()` render
 * override, and an optional `empty` slot.
 */

export type ColumnAlign = "left" | "right"

export interface ResponsiveTableColumn<TRow> {
  /** Stable column id; also the React key for header/value pairs. */
  key: string
  /** Visible column header (already translated by the caller). */
  header: ReactNode
  /**
   * The card title column `< md`. Exactly one column should set this; if
   * `rowHref` is given the title becomes the row-link. If none is marked
   * primary the first column is used.
   */
  primary?: boolean
  /** `right` right-aligns the cell and applies `.tabular-nums` (money/counts). */
  align?: ColumnAlign
  /**
   * Render override for the cell value (status `Badge`, formatted money, links,
   * etc.). When omitted, `row[key]` is read and rendered as-is.
   */
  cell?: (row: TRow) => ReactNode
}

export interface ResponsiveTableProps<TRow> {
  columns: ReadonlyArray<ResponsiveTableColumn<TRow>>
  rows: ReadonlyArray<TRow>
  /** Stable per-row key (React key + `data-row-key` on the table row / card). */
  getRowKey: (row: TRow) => string
  /** Makes the row (table row + the card title) a link to this href. */
  rowHref?: (row: TRow) => string
  /**
   * Per-row attributes spread onto BOTH the `≥ md` `TableRow` and the `< md`
   * `Card`. Lets the sweep preserve per-row E2E selectors
   * (`data-booking-id`, `data-booking-state`, `data-vendor-id`, etc.).
   */
  rowProps?: (row: TRow) => Record<string, string>
  /** Accessible table caption (rendered `sr-only` by default). */
  caption?: ReactNode
  /** Shown in place of both renderings when `rows` is empty. */
  empty?: ReactNode
  /** Extra classes on the outer wrapper. */
  className?: string
}

function renderCellValue<TRow>(
  column: ResponsiveTableColumn<TRow>,
  row: TRow,
): ReactNode {
  if (column.cell) {
    return column.cell(row)
  }
  // No render override: read the column key off the row. Guarded so a missing
  // key renders nothing rather than `[object Object]`/`undefined`.
  const value = (row as Record<string, unknown>)[column.key]
  if (value === null || value === undefined) {
    return null
  }
  return value as ReactNode
}

function primaryColumn<TRow>(
  columns: ReadonlyArray<ResponsiveTableColumn<TRow>>,
): ResponsiveTableColumn<TRow> {
  return columns.find((column) => column.primary) ?? columns[0]
}

export function ResponsiveTable<TRow>({
  columns,
  rows,
  getRowKey,
  rowHref,
  rowProps,
  caption,
  empty,
  className,
}: ResponsiveTableProps<TRow>) {
  const isEmpty = rows.length === 0
  const primary = primaryColumn(columns)

  return (
    <div data-slot="responsive-table" className={className}>
      {/* ≥ md — the A3 table. The `Table` primitive renders its own
          `overflow-x-auto` container (`data-slot="table-container"`), which
          keeps the documented horizontal-scroll fallback for tablet/desktop
          (DESIGN.md §8.7). */}
      <Card className="hidden md:block">
        <CardContent className="p-0">
          <Table>
            {caption ? (
              <TableCaption className="sr-only">{caption}</TableCaption>
            ) : null}
            <TableHeader>
              <TableRow>
                {columns.map((column) => (
                  <TableHead
                    key={column.key}
                    scope="col"
                    className={cn(
                      column.align === "right" && "text-right tabular-nums",
                    )}
                  >
                    {column.header}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {isEmpty ? (
                <TableRow>
                  <TableCell
                    colSpan={columns.length}
                    className="py-8 text-center text-muted-foreground"
                  >
                    {empty ?? "No results."}
                  </TableCell>
                </TableRow>
              ) : (
                rows.map((row) => {
                  const key = getRowKey(row)
                  const href = rowHref?.(row)
                  return (
                    <TableRow key={key} data-row-key={key} {...rowProps?.(row)}>
                      {columns.map((column) => {
                        const value = renderCellValue(column, row)
                        const isPrimaryLink = column === primary && href
                        return (
                          <TableCell
                            key={column.key}
                            className={cn(
                              column.align === "right" &&
                                "text-right tabular-nums",
                            )}
                          >
                            {isPrimaryLink ? (
                              <Link
                                href={href}
                                className="font-medium hover:underline"
                              >
                                {value}
                              </Link>
                            ) : (
                              value
                            )}
                          </TableCell>
                        )
                      })}
                    </TableRow>
                  )
                })
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* < md — stacked label:value Cards. The stack is a labelled region so
          the `sr-only` caption names the collection (rather than floating as a
          detached span). The `≥ md` `TableCaption` is kept as-is. */}
      <div
        className="flex flex-col gap-3 md:hidden"
        role="group"
        aria-label={typeof caption === "string" ? caption : undefined}
      >
        {caption && typeof caption !== "string" ? (
          <span className="sr-only">{caption}</span>
        ) : null}
        {isEmpty ? (
          <Card size="sm">
            <CardContent className="py-8 text-center text-sm text-muted-foreground">
              {empty ?? "No results."}
            </CardContent>
          </Card>
        ) : (
          rows.map((row) => {
            const key = getRowKey(row)
            const href = rowHref?.(row)
            const title = renderCellValue(primary, row)
            const detailColumns = columns.filter(
              (column) => column !== primary,
            )
            return (
              <Card key={key} size="sm" data-row-key={key} {...rowProps?.(row)}>
                <CardContent className="flex flex-col gap-3 py-3">
                  <div className="font-heading text-sm font-medium leading-snug">
                    {href ? (
                      <Link href={href} className="hover:underline">
                        {title}
                      </Link>
                    ) : (
                      title
                    )}
                  </div>
                  <dl className="flex flex-col gap-1.5">
                    {detailColumns.map((column) => (
                      <div
                        key={column.key}
                        className="flex items-baseline justify-between gap-3 text-sm"
                      >
                        <dt className="shrink-0 text-muted-foreground">
                          {column.header}
                        </dt>
                        <dd
                          className={cn(
                            "min-w-0 text-right",
                            column.align === "right" && "tabular-nums",
                          )}
                        >
                          {renderCellValue(column, row)}
                        </dd>
                      </div>
                    ))}
                  </dl>
                </CardContent>
              </Card>
            )
          })
        )}
      </div>
    </div>
  )
}
