import { Label, Input } from "outvers-next";

const stack: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 6,
  width: 320,
};

export function WithInput() {
  return (
    <div style={stack}>
      <Label htmlFor="name">Full name</Label>
      <Input id="name" placeholder="As per government ID" />
    </div>
  );
}

export function Disabled() {
  return (
    <div style={stack}>
      <Label htmlFor="gst" data-disabled="true">
        GST number (optional)
      </Label>
      <Input id="gst" disabled placeholder="29ABCDE1234F1Z5" />
    </div>
  );
}
