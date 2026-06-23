import { Button } from "outvers-next";

const row: React.CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  gap: 12,
  alignItems: "center",
};

export function Variants() {
  return (
    <div style={row}>
      <Button>Book now</Button>
      <Button variant="secondary">Save for later</Button>
      <Button variant="outline">View details</Button>
      <Button variant="ghost">Cancel</Button>
      <Button variant="destructive">Remove</Button>
      <Button variant="link">Learn more</Button>
    </div>
  );
}

export function Sizes() {
  return (
    <div style={row}>
      <Button size="xs">Extra small</Button>
      <Button size="sm">Small</Button>
      <Button size="default">Default</Button>
      <Button size="lg">Large</Button>
    </div>
  );
}

export function States() {
  return (
    <div style={row}>
      <Button>Enabled</Button>
      <Button disabled>Disabled</Button>
      <Button variant="outline" disabled>
        Unavailable
      </Button>
    </div>
  );
}
