import { formatRupees, formatRupeesDeduction } from './money'

/**
 * The Commission Snapshot waterfall (CONTEXT.md / ADR-0016):
 *
 *   Payout = gross − Commission − GST(on commission) − TDS(§194-O) − TCS(§52) = net
 *
 * Rendered as a right-aligned `.tabular-nums` ledger so the operator sees the
 * full decomposition that produced the Net Vendor Payout. Per #58 direction B
 * this is shown CO-PRESENT with the approve/hold/reject action panel — the
 * load-bearing fix (the breakdown and the action are finally on screen
 * together). All figures are the integer-rupee values derived from the
 * Booking's locked snapshot columns via `computeVendorNetPayout`.
 */
export interface CommissionSnapshotProps {
  grossRupees: number
  commissionRupees: number
  commissionRatePercent: string
  gstOnCommissionRupees: number
  tdsRupees: number
  tcsRupees: number
  netPayoutRupees: number
}

function SnapshotRow({
  label,
  testId,
  value,
  deduction = false,
}: {
  label: string
  testId: string
  value: number
  deduction?: boolean
}) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-1 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span
        data-testid={testId}
        className={`tabular-nums ${deduction ? 'text-muted-foreground' : ''}`}
      >
        {deduction ? formatRupeesDeduction(value) : formatRupees(value)}
      </span>
    </div>
  )
}

export function CommissionSnapshot({
  grossRupees,
  commissionRupees,
  commissionRatePercent,
  gstOnCommissionRupees,
  tdsRupees,
  tcsRupees,
  netPayoutRupees,
}: CommissionSnapshotProps) {
  const rate = Number(commissionRatePercent).toFixed(1)
  return (
    <div data-testid="commission-snapshot">
      <h3 className="mb-2 text-sm font-semibold">Commission Snapshot</h3>
      <div className="divide-y">
        <SnapshotRow label="Gross Total" testId="snapshot-gross" value={grossRupees} />
        <SnapshotRow
          label={`Commission (${rate}%)`}
          testId="snapshot-commission"
          value={commissionRupees}
          deduction
        />
        <SnapshotRow
          label="GST on commission"
          testId="snapshot-gst"
          value={gstOnCommissionRupees}
          deduction
        />
        <SnapshotRow label="TDS (§194-O)" testId="snapshot-tds" value={tdsRupees} deduction />
        <SnapshotRow label="TCS (§52)" testId="snapshot-tcs" value={tcsRupees} deduction />
      </div>
      <div className="mt-2 flex items-baseline justify-between gap-4 border-t-2 pt-2">
        <span className="text-sm font-semibold">Net Vendor Payout</span>
        <span
          data-testid="snapshot-net"
          className="text-base font-semibold tabular-nums text-success"
        >
          {formatRupees(netPayoutRupees)}
        </span>
      </div>
    </div>
  )
}
