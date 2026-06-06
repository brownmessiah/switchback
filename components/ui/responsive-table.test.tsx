/**
 * Tests for `<ResponsiveTable>` — the A3-reversal table wrapper
 * (DESIGN.md §8.5 item 2; ADR-0018).
 *
 * Both renderings live in the DOM at once (the md/below-md switch is a CSS
 * `hidden md:block` / `md:hidden` swap, not conditional mounting), so jsdom —
 * which doesn't evaluate media queries — sees both. The assertions target each
 * rendering by its `data-slot` container:
 *
 *  - the `≥ md` Table has the right column headers and links its primary cell;
 *  - the `< md` Card stack carries every column value (label + value) per row.
 *
 * NOTE: this test is co-located with the component under `components/ui/`. The
 * repo's `vitest.config.ts` `include` glob currently covers `app`,
 * `lib`, `db` and `tests/unit` only — the orchestrator owns adding the
 * components test glob to that list so this file is picked up.
 */

import { cleanup, render, screen, within } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"

import { Badge } from "@/components/ui/badge"

import {
  ResponsiveTable,
  type ResponsiveTableColumn,
  type ResponsiveTableProps,
} from "./responsive-table"

afterEach(() => {
  cleanup()
})

interface DemoRow {
  id: string
  name: string
  amount: string
  status: string
}

const ROWS: DemoRow[] = [
  { id: "bk_001", name: "Alice Vendor", amount: "₹1,200", status: "confirmed" },
  { id: "bk_002", name: "Bob Vendor", amount: "₹3,450", status: "pending" },
]

const COLUMNS: ResponsiveTableColumn<DemoRow>[] = [
  { key: "name", header: "Vendor", primary: true },
  { key: "amount", header: "Amount", align: "right" },
  {
    key: "status",
    header: "Status",
    cell: (row) => <Badge variant="success">{row.status}</Badge>,
  },
]

function renderTable(override?: Partial<ResponsiveTableProps<DemoRow>>) {
  return render(
    <ResponsiveTable<DemoRow>
      columns={COLUMNS}
      rows={ROWS}
      getRowKey={(row) => row.id}
      rowHref={(row) => `/admin/bookings/${row.id}`}
      caption="All bookings"
      {...override}
    />,
  )
}

describe("ResponsiveTable — ≥ md table rendering", () => {
  it("renders a column header for every column", () => {
    renderTable()
    const grid = screen.getByRole("table")
    expect(within(grid).getByText("Vendor")).toBeInTheDocument()
    expect(within(grid).getByText("Amount")).toBeInTheDocument()
    expect(within(grid).getByText("Status")).toBeInTheDocument()
  })

  it("links the primary column cell to the row href in the table", () => {
    const { container } = renderTable()
    const table = container.querySelector("[data-slot='table']")
    expect(table).not.toBeNull()
    const primaryLink = within(table as HTMLElement).getByRole("link", {
      name: "Alice Vendor",
    })
    expect(primaryLink).toHaveAttribute("href", "/admin/bookings/bk_001")
  })

  it("right-aligns numeric columns with tabular-nums in the table head", () => {
    const { container } = renderTable()
    const amountHead = within(container).getAllByText("Amount")[0]
    // the table header cell carries the alignment classes
    const headCell = amountHead.closest("[data-slot='table-head']")
    expect(headCell).toHaveClass("text-right")
    expect(headCell).toHaveClass("tabular-nums")
  })
})

describe("ResponsiveTable — < md card rendering", () => {
  function cardStack(container: HTMLElement): HTMLElement {
    const stack = container.querySelector(".md\\:hidden")
    expect(stack).not.toBeNull()
    return stack as HTMLElement
  }

  it("renders one card per row carrying every column value", () => {
    const { container } = renderTable()
    const stack = cardStack(container)

    // Each row's values are present in the stacked card view.
    expect(within(stack).getAllByText("Alice Vendor").length).toBeGreaterThan(0)
    expect(within(stack).getByText("₹1,200")).toBeInTheDocument()
    expect(within(stack).getByText("Bob Vendor")).toBeInTheDocument()
    expect(within(stack).getByText("₹3,450")).toBeInTheDocument()
  })

  it("renders non-primary columns as header:value pairs", () => {
    const { container } = renderTable()
    const stack = cardStack(container)
    // The non-primary headers become <dt> labels in the card.
    const terms = stack.querySelectorAll("dt")
    const labels = Array.from(terms).map((t) => t.textContent)
    expect(labels).toContain("Amount")
    expect(labels).toContain("Status")
    // The primary column is the card title, NOT a header:value pair.
    expect(labels).not.toContain("Vendor")
  })

  it("titles each card with the primary column as a row-link", () => {
    const { container } = renderTable()
    const stack = cardStack(container)
    const titleLink = within(stack).getByRole("link", { name: "Alice Vendor" })
    expect(titleLink).toHaveAttribute("href", "/admin/bookings/bk_001")
  })

  it("keeps status cells rendered via cell() (Badge survives the card view)", () => {
    const { container } = renderTable()
    const stack = cardStack(container)
    const badges = stack.querySelectorAll("[data-slot='badge']")
    expect(badges.length).toBe(ROWS.length)
    expect(badges[0]).toHaveTextContent("confirmed")
  })
})

describe("ResponsiveTable — edge cases", () => {
  it("renders the primary column as plain text (no link) when rowHref is absent", () => {
    const { container } = renderTable({ rowHref: undefined })
    expect(
      within(container).queryByRole("link", { name: "Alice Vendor" }),
    ).toBeNull()
    // value still present in both renderings
    expect(within(container).getAllByText("Alice Vendor").length).toBeGreaterThan(0)
  })

  it("uses the first column as primary when none is marked", () => {
    const columns: ResponsiveTableColumn<DemoRow>[] = [
      { key: "name", header: "Vendor" },
      { key: "amount", header: "Amount", align: "right" },
    ]
    const { container } = render(
      <ResponsiveTable<DemoRow>
        columns={columns}
        rows={ROWS}
        getRowKey={(row) => row.id}
        rowHref={(row) => `/x/${row.id}`}
      />,
    )
    const stack = container.querySelector(".md\\:hidden") as HTMLElement
    // first column (name) is the title link; not a dt label
    const labels = Array.from(stack.querySelectorAll("dt")).map(
      (t) => t.textContent,
    )
    expect(labels).not.toContain("Vendor")
    expect(labels).toContain("Amount")
  })

  it("renders the empty slot in both renderings when rows is empty", () => {
    const { container } = renderTable({ rows: [], empty: "Nothing here" })
    // table empty cell + card empty state both show the message
    expect(within(container).getAllByText("Nothing here").length).toBe(2)
    // no data rows rendered
    expect(container.querySelectorAll("[data-row-key]").length).toBe(0)
  })

  it("renders the accessible caption", () => {
    renderTable()
    expect(screen.getAllByText("All bookings").length).toBeGreaterThan(0)
  })
})
