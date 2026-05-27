export default function VendorMessagesPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Messages</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Communicate with customers about their bookings.
        </p>
      </div>

      <div className="flex flex-col items-center justify-center rounded-lg border py-16 text-center">
        <p className="text-lg font-medium">No messages yet</p>
        <p className="mt-1 text-sm text-muted-foreground">
          Messages from customers will appear here.
        </p>
      </div>
    </div>
  )
}
