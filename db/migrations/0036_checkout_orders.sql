-- Checkout order envelope + order-scoped payments (issue 12, ADR-0021).
--
-- A cart checkout creates N independent Bookings under ONE outer
-- transaction and ONE order-scoped Razorpay payment. Additive only: the
-- single-item booking-scoped payment path is untouched; existing payments
-- rows (booking_id set, order_id NULL) satisfy the new XOR CHECK.
--
-- Hand-authored per the repo migration policy (never drizzle-kit generate).
-- MUST stay in lockstep with db/schema/orders.ts + payments.ts + bookings.ts
-- (the drizzle definitions also drive the e2e DB via drizzle-kit push).
CREATE TYPE "public"."order_state" AS ENUM('created', 'paid');
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "orders" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "customer_user_id" text NOT NULL,
  "razorpay_order_id" text,
  "amount_total_snapshot" numeric(14,2) NOT NULL,
  "state" "order_state" DEFAULT 'created' NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "orders_razorpay_order_id_unique" UNIQUE("razorpay_order_id"),
  CONSTRAINT "orders_customer_user_id_users_id_fk"
    FOREIGN KEY ("customer_user_id") REFERENCES "users"("id") ON DELETE RESTRICT
);
--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN IF NOT EXISTS "order_id" uuid;
--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_order_id_orders_id_fk"
  FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE RESTRICT;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "bookings_by_order" ON "bookings" ("order_id");
--> statement-breakpoint
ALTER TABLE "payments" ALTER COLUMN "booking_id" DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN IF NOT EXISTS "order_id" uuid;
--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_order_id_orders_id_fk"
  FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE RESTRICT;
--> statement-breakpoint
-- A payment is booking-scoped (legacy single-item) XOR order-scoped (cart).
ALTER TABLE "payments" ADD CONSTRAINT "payment_scope_exactly_one"
  CHECK (("booking_id" IS NOT NULL AND "order_id" IS NULL)
      OR ("booking_id" IS NULL AND "order_id" IS NOT NULL));
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "payments_by_order" ON "payments" ("order_id");
