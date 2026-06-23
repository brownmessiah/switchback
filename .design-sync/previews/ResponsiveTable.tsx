import { ResponsiveTable, Badge } from "outvers-next";

interface BookingRow {
  id: string;
  experience: string;
  destination: string;
  date: string;
  guests: string;
  amount: string;
  status: "confirmed" | "pending" | "permit";
}

const STATUS: Record<
  BookingRow["status"],
  { label: string; variant: "success" | "warning" | "info" }
> = {
  confirmed: { label: "Confirmed", variant: "success" },
  pending: { label: "Pending payment", variant: "warning" },
  permit: { label: "Awaiting permit", variant: "info" },
};

const rows: BookingRow[] = [
  {
    id: "OV-10241",
    experience: "Rishikesh White-Water Rafting",
    destination: "Rishikesh, Uttarakhand",
    date: "12 Oct, 9:00 AM",
    guests: "2 adults",
    amount: "₹3,000",
    status: "confirmed",
  },
  {
    id: "OV-10242",
    experience: "Bir Billing Paragliding",
    destination: "Bir, Himachal Pradesh",
    date: "14 Oct, 11:30 AM",
    guests: "1 adult",
    amount: "₹3,200",
    status: "pending",
  },
  {
    id: "OV-10243",
    experience: "Goa Scuba Diving — Grande Island",
    destination: "Goa",
    date: "18 Oct, 7:00 AM",
    guests: "2 adults, 1 child",
    amount: "₹8,400",
    status: "permit",
  },
  {
    id: "OV-10244",
    experience: "Manali Solang Valley Trek",
    destination: "Manali, Himachal Pradesh",
    date: "21 Oct, 6:00 AM",
    guests: "4 adults",
    amount: "₹6,000",
    status: "confirmed",
  },
];

export function BookingsTable() {
  return (
    <ResponsiveTable<BookingRow>
      caption="Your upcoming adventure bookings"
      getRowKey={(row) => row.id}
      rowHref={(row) => `/dashboard/bookings/${row.id}`}
      columns={[
        {
          key: "experience",
          header: "Experience",
          primary: true,
          cell: (row) => (
            <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
              <span>{row.experience}</span>
              <span style={{ fontSize: 12, color: "var(--muted-foreground)" }}>
                {row.destination}
              </span>
            </div>
          ),
        },
        { key: "date", header: "Date", cell: (row) => row.date },
        { key: "guests", header: "Guests", cell: (row) => row.guests },
        {
          key: "amount",
          header: "Amount",
          align: "right",
          cell: (row) => row.amount,
        },
        {
          key: "status",
          header: "Status",
          cell: (row) => (
            <Badge variant={STATUS[row.status].variant}>
              {STATUS[row.status].label}
            </Badge>
          ),
        },
      ]}
      rows={rows}
    />
  );
}
