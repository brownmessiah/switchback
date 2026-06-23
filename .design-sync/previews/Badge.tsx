import { Badge } from "outvers-next";

const wrap: React.CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  gap: 8,
  alignItems: "center",
  maxWidth: 420,
};

export function AllVariants() {
  return (
    <div style={wrap}>
      <Badge variant="default">Featured</Badge>
      <Badge variant="secondary">Day trip</Badge>
      <Badge variant="destructive">Sold out</Badge>
      <Badge variant="success">Verified</Badge>
      <Badge variant="warning">Few spots left</Badge>
      <Badge variant="info">New</Badge>
      <Badge variant="credit">Wallet credit</Badge>
      <Badge variant="outline">Beginner</Badge>
      <Badge variant="ghost">Refundable</Badge>
      <Badge variant="link">View details</Badge>
    </div>
  );
}

export function StatusRow() {
  return (
    <div style={wrap}>
      <Badge variant="success">Confirmed</Badge>
      <Badge variant="warning">Pending payment</Badge>
      <Badge variant="info">Awaiting permit</Badge>
      <Badge variant="destructive">Cancelled</Badge>
    </div>
  );
}
