import { Alert, AlertTitle, AlertDescription } from "outvers-next";

const stack: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 12,
  maxWidth: 460,
};

export function Variants() {
  return (
    <div style={stack}>
      <Alert>
        <AlertTitle>Booking held</AlertTitle>
        <AlertDescription>
          Your spot is reserved for 15 minutes while you complete payment.
        </AlertDescription>
      </Alert>
      <Alert variant="success">
        <AlertTitle>Payment received</AlertTitle>
        <AlertDescription>
          Your booking is confirmed. A voucher has been sent to your email.
        </AlertDescription>
      </Alert>
      <Alert variant="warning">
        <AlertTitle>Weather advisory</AlertTitle>
        <AlertDescription>
          Heavy rain is forecast for your activity date — the operator may
          reschedule.
        </AlertDescription>
      </Alert>
      <Alert variant="destructive">
        <AlertTitle>Payment failed</AlertTitle>
        <AlertDescription>
          We couldn&apos;t charge your card. Please try a different payment
          method.
        </AlertDescription>
      </Alert>
    </div>
  );
}

export function Info() {
  return (
    <div style={stack}>
      <Alert variant="info">
        <AlertTitle>Free cancellation</AlertTitle>
        <AlertDescription>
          Cancel up to 24 hours before the start time for a full refund to your
          wallet.
        </AlertDescription>
      </Alert>
    </div>
  );
}
