CREATE TYPE "public"."refund_destination" AS ENUM('refund_balance', 'original_payment_method');--> statement-breakpoint
CREATE TYPE "public"."refund_reason" AS ENUM('inside_policy_cancellation', 'outside_policy_dispute_resolved', 'vendor_cancelled', 'admin_override');--> statement-breakpoint
CREATE TYPE "public"."refund_request_state" AS ENUM('pending', 'approved', 'credited', 'failed', 'rejected');--> statement-breakpoint
CREATE TABLE "refund_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"booking_id" uuid NOT NULL,
	"requested_by_user_id" text NOT NULL,
	"reason" "refund_reason" NOT NULL,
	"destination" "refund_destination" NOT NULL,
	"state" "refund_request_state" DEFAULT 'pending' NOT NULL,
	"amount" numeric(14, 2) NOT NULL,
	"cancellation_preset_snapshot" text NOT NULL,
	"policy_window_basis_snapshot" text NOT NULL,
	"notes" text,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "non_negative_refund_amount" CHECK ("refund_requests"."amount" >= 0)
);
--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "refund_request_id" uuid;--> statement-breakpoint
ALTER TABLE "refund_requests" ADD CONSTRAINT "refund_requests_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refund_requests" ADD CONSTRAINT "refund_requests_requested_by_user_id_users_id_fk" FOREIGN KEY ("requested_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "refund_requests_by_booking" ON "refund_requests" USING btree ("booking_id");--> statement-breakpoint
CREATE INDEX "refund_requests_by_state" ON "refund_requests" USING btree ("state");--> statement-breakpoint
CREATE INDEX "refund_requests_by_time" ON "refund_requests" USING btree ("created_at");--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_refund_request_id_refund_requests_id_fk" FOREIGN KEY ("refund_request_id") REFERENCES "public"."refund_requests"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "refund_reverse_requires_request" CHECK (("payments"."capture_trigger" <> 'refund_reverse') OR ("payments"."refund_request_id" IS NOT NULL));