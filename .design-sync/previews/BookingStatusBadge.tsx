import { BookingStatusBadge } from "outvers-next";

const wrap: React.CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  gap: 10,
  alignItems: "center",
};

export function Active() {
  return (
    <div style={wrap}>
      <BookingStatusBadge state="confirmed" label="Confirmed" />
      <BookingStatusBadge state="pending_payment" label="Payment pending" />
      <BookingStatusBadge state="awaiting_completion" label="Awaiting completion" />
      <BookingStatusBadge state="completed" label="Completed" />
    </div>
  );
}

export function Terminal() {
  return (
    <div style={wrap}>
      <BookingStatusBadge state="cancelled_by_customer" label="Cancelled by you" />
      <BookingStatusBadge state="cancelled_by_vendor" label="Cancelled by operator" />
      <BookingStatusBadge state="disputed" label="Under dispute" />
      <BookingStatusBadge state="no_show" label="No-show" />
    </div>
  );
}
