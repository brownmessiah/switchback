import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuItem,
  DropdownMenuSeparator,
  Button,
} from "outvers-next";

export function BookingActions() {
  return (
    <DropdownMenu defaultOpen>
      <DropdownMenuTrigger render={<Button variant="outline">Actions</Button>} />
      <DropdownMenuContent style={{ minWidth: 220 }}>
        <DropdownMenuLabel>Booking OV-10241</DropdownMenuLabel>
        <DropdownMenuItem>View voucher</DropdownMenuItem>
        <DropdownMenuItem>Reschedule date</DropdownMenuItem>
        <DropdownMenuItem>Download invoice</DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem variant="destructive">Cancel booking</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
