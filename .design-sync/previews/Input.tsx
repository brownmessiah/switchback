import { Input, Label } from "outvers-next";

const stack: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 6,
  width: 320,
};

export function Default() {
  return (
    <div style={{ width: 320 }}>
      <Input placeholder="Search experiences in Manali" />
    </div>
  );
}

export function WithLabel() {
  return (
    <div style={stack}>
      <Label htmlFor="email">Email address</Label>
      <Input id="email" type="email" placeholder="you@example.com" />
    </div>
  );
}

export function Disabled() {
  return (
    <div style={stack}>
      <Label htmlFor="ref">Booking reference</Label>
      <Input id="ref" disabled value="OUT-RSH-48213" />
    </div>
  );
}

export function Invalid() {
  return (
    <div style={stack}>
      <Label htmlFor="phone">Phone number</Label>
      <Input id="phone" aria-invalid value="98xx" />
      <span style={{ fontSize: 12, color: "var(--destructive)" }}>
        Enter a valid 10-digit mobile number
      </span>
    </div>
  );
}
