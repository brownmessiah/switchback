import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogClose,
  Button,
} from "outvers-next";

export function CancelBooking() {
  return (
    <Dialog defaultOpen>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Cancel this booking?</DialogTitle>
          <DialogDescription>
            Your Bir Billing paragliding session on 14 Oct will be cancelled.
            A full refund of ₹3,200 will be credited to your wallet.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <DialogClose render={<Button variant="outline" />}>
            Keep booking
          </DialogClose>
          <Button variant="destructive">Cancel booking</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
