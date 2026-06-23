import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetFooter,
  SheetClose,
  Button,
} from "outvers-next";

const row: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  padding: "10px 16px",
  fontSize: 14,
  color: "var(--foreground)",
  borderBottom: "1px solid var(--border)",
};

const label: React.CSSProperties = {
  color: "var(--muted-foreground)",
};

export function BookingSummary() {
  return (
    <Sheet defaultOpen>
      <SheetContent side="right">
        <SheetHeader>
          <SheetTitle>Booking summary</SheetTitle>
          <SheetDescription>
            Rishikesh White-Water Rafting · 16 km stretch
          </SheetDescription>
        </SheetHeader>
        <div style={{ display: "flex", flexDirection: "column" }}>
          <div style={row}>
            <span style={label}>Date</span>
            <span>12 Oct, 9:00 AM</span>
          </div>
          <div style={row}>
            <span style={label}>Guests</span>
            <span>2 adults</span>
          </div>
          <div style={row}>
            <span style={label}>Per person</span>
            <span>₹1,500</span>
          </div>
          <div style={{ ...row, fontWeight: 600 }}>
            <span>Total</span>
            <span>₹3,000</span>
          </div>
        </div>
        <SheetFooter>
          <Button>Proceed to payment</Button>
          <SheetClose render={<Button variant="outline" />}>
            Edit booking
          </SheetClose>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
