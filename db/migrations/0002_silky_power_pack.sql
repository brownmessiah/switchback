CREATE TYPE "public"."booking_state" AS ENUM('confirmed', 'awaiting_completion', 'completed', 'disputed', 'cancelled_by_customer', 'cancelled_by_vendor', 'cancelled_post_experience');--> statement-breakpoint
CREATE TYPE "public"."payment_mode_booking" AS ENUM('full_upfront', 'partial_pay', 'reserve_now_pay_later');--> statement-breakpoint
CREATE TYPE "public"."capture_trigger" AS ENUM('booking_create', 'auto_capture_t_minus_24h', 'escrow_full_capture', 'manual_admin', 'refund_reverse');--> statement-breakpoint
CREATE TABLE "bookings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"customer_user_id" text NOT NULL,
	"experience_id" uuid NOT NULL,
	"slot_id" uuid NOT NULL,
	"participant_count" integer NOT NULL,
	"state" "booking_state" DEFAULT 'confirmed' NOT NULL,
	"payment_mode" "payment_mode_booking" NOT NULL,
	"gross_total_snapshot" numeric(14, 2) NOT NULL,
	"price_per_participant_snapshot" numeric(12, 2) NOT NULL,
	"pricing_basis_snapshot" text NOT NULL,
	"commission_rate_snapshot" numeric(5, 2) NOT NULL,
	"commission_basis_snapshot" text NOT NULL,
	"cancellation_preset_snapshot" text NOT NULL,
	"tds_amount_snapshot" numeric(14, 2) DEFAULT '0.00' NOT NULL,
	"trip_group_id" uuid,
	"confirmed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"auto_completed" boolean DEFAULT false NOT NULL,
	"cancelled_at" timestamp with time zone,
	"cancellation_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "positive_participants" CHECK ("bookings"."participant_count" > 0),
	CONSTRAINT "non_negative_gross" CHECK ("bookings"."gross_total_snapshot" >= 0),
	CONSTRAINT "non_negative_price_per_participant" CHECK ("bookings"."price_per_participant_snapshot" >= 0),
	CONSTRAINT "commission_rate_in_range" CHECK ("bookings"."commission_rate_snapshot" >= 0 AND "bookings"."commission_rate_snapshot" <= 100),
	CONSTRAINT "non_negative_tds" CHECK ("bookings"."tds_amount_snapshot" >= 0)
);
--> statement-breakpoint
CREATE TABLE "payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"booking_id" uuid NOT NULL,
	"razorpay_payment_id" text NOT NULL,
	"razorpay_order_id" text,
	"amount" numeric(14, 2) NOT NULL,
	"capture_trigger" "capture_trigger" NOT NULL,
	"captured_at" timestamp with time zone DEFAULT now() NOT NULL,
	"raw_webhook_payload" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payments_razorpay_payment_id_unique" UNIQUE("razorpay_payment_id"),
	CONSTRAINT "amount_sign_matches_trigger" CHECK (("payments"."capture_trigger" = 'refund_reverse' AND "payments"."amount" < 0) OR
          ("payments"."capture_trigger" <> 'refund_reverse' AND "payments"."amount" > 0))
);
--> statement-breakpoint
CREATE TABLE "commission_tiers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"start_at" timestamp with time zone NOT NULL,
	"end_at" timestamp with time zone NOT NULL,
	"applies_to_categories" text[] DEFAULT '{}' NOT NULL,
	"applies_to_vendor_ids" text[] DEFAULT '{}' NOT NULL,
	"applies_to_experience_ids" text[] DEFAULT '{}' NOT NULL,
	"rate_override" numeric(5, 2) NOT NULL,
	"reason" text NOT NULL,
	"created_by_admin_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "commission_tier_time_ordered" CHECK ("commission_tiers"."end_at" > "commission_tiers"."start_at"),
	CONSTRAINT "commission_rate_in_range" CHECK ("commission_tiers"."rate_override" >= 0 AND "commission_tiers"."rate_override" <= 100)
);
--> statement-breakpoint
CREATE TABLE "pricing_tiers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"start_at" timestamp with time zone NOT NULL,
	"end_at" timestamp with time zone NOT NULL,
	"applies_to_categories" text[] DEFAULT '{}' NOT NULL,
	"applies_to_vendor_ids" text[] DEFAULT '{}' NOT NULL,
	"applies_to_experience_ids" text[] DEFAULT '{}' NOT NULL,
	"price_per_person_override" numeric(12, 2) NOT NULL,
	"reason" text NOT NULL,
	"created_by_admin_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pricing_tier_time_ordered" CHECK ("pricing_tiers"."end_at" > "pricing_tiers"."start_at"),
	CONSTRAINT "non_negative_price_override" CHECK ("pricing_tiers"."price_per_person_override" >= 0)
);
--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_customer_user_id_users_id_fk" FOREIGN KEY ("customer_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_experience_id_experiences_id_fk" FOREIGN KEY ("experience_id") REFERENCES "public"."experiences"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_slot_id_availability_slots_id_fk" FOREIGN KEY ("slot_id") REFERENCES "public"."availability_slots"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE restrict ON UPDATE no action;