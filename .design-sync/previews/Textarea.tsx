import { Textarea, Label } from "outvers-next";

const stack: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 6,
  width: 380,
};

export function Placeholder() {
  return (
    <div style={stack}>
      <Label htmlFor="review">Write a review</Label>
      <Textarea
        id="review"
        placeholder="Tell other adventurers about your Rishikesh rafting trip…"
      />
    </div>
  );
}

export function Filled() {
  return (
    <div style={stack}>
      <Label htmlFor="draft">Your review</Label>
      <Textarea
        id="draft"
        defaultValue={
          "Did the Hampta Pass crossing with Outvers in June. Our guide Tenzin was incredible — knew every ridge by name.\n\nThe river crossing on day 3 was the highlight. Gear was top-notch and the camp food kept us going. Would book again in a heartbeat."
        }
      />
    </div>
  );
}

export function Disabled() {
  return (
    <div style={stack}>
      <Label htmlFor="notes" data-disabled="true">
        Operator notes
      </Label>
      <Textarea
        id="notes"
        disabled
        defaultValue="Itinerary locked. Contact support to request changes."
      />
    </div>
  );
}
