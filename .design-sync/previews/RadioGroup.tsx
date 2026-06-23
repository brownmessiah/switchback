import { RadioGroup, RadioGroupItem, Label } from "outvers-next";

const row: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 10,
};

export function Difficulty() {
  return (
    <RadioGroup defaultValue="moderate" style={{ width: 280 }}>
      <Label htmlFor="r-easy" style={row}>
        <RadioGroupItem id="r-easy" value="easy" />
        Easy — gentle day hikes
      </Label>
      <Label htmlFor="r-moderate" style={row}>
        <RadioGroupItem id="r-moderate" value="moderate" />
        Moderate — Triund, Kheerganga
      </Label>
      <Label htmlFor="r-challenging" style={row}>
        <RadioGroupItem id="r-challenging" value="challenging" />
        Challenging — Hampta Pass, Stok Kangri
      </Label>
    </RadioGroup>
  );
}

export function GroupSize() {
  return (
    <RadioGroup defaultValue="small" style={{ width: 280 }}>
      <Label htmlFor="g-solo" style={row}>
        <RadioGroupItem id="g-solo" value="solo" />
        Solo traveller
      </Label>
      <Label htmlFor="g-small" style={row}>
        <RadioGroupItem id="g-small" value="small" />
        Small group (2–6)
      </Label>
      <Label htmlFor="g-large" style={row}>
        <RadioGroupItem id="g-large" value="large" />
        Large group (7+)
      </Label>
    </RadioGroup>
  );
}
