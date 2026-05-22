CREATE TYPE "public"."booking_state" AS ENUM('confirmed', 'awaiting_completion', 'completed', 'disputed', 'cancelled_by_customer', 'cancelled_by_vendor', 'cancelled_post_experience');--> statement-breakpoint
CREATE TYPE "public"."payment_mode_booking" AS ENUM('full_upfront', 'partial_pay', 'reserve_now_pay_later');--> statement-breakpoint
CREATE TYPE "public"."capture_trigger" AS ENUM('booking_create', 'auto_capture_t_minus_24h', 'escrow_full_capture', 'manual_admin', 'refund_reverse');--> statement-breakpoint
CREATE TYPE "public"."wallet_balance_type" AS ENUM('outvers_credit', 'refund_balance');--> statement-breakpoint
CREATE TYPE "public"."ai_surface" AS ENUM('review_summary', 'listing_draft', 'inbox_reply', 'trip_planner');--> statement-breakpoint
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
	"gst_rate_on_commission_snapshot" numeric(5, 2) DEFAULT '18.00' NOT NULL,
	"vendor_pan_snapshot" text,
	"vendor_is_resident_snapshot" boolean DEFAULT true NOT NULL,
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
	CONSTRAINT "gst_rate_in_range" CHECK ("bookings"."gst_rate_on_commission_snapshot" >= 0 AND "bookings"."gst_rate_on_commission_snapshot" <= 100),
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
	"applies_to_experience_ids" uuid[] DEFAULT '{}' NOT NULL,
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
	"applies_to_experience_ids" uuid[] DEFAULT '{}' NOT NULL,
	"price_per_person_override" numeric(12, 2) NOT NULL,
	"reason" text NOT NULL,
	"created_by_admin_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pricing_tier_time_ordered" CHECK ("pricing_tiers"."end_at" > "pricing_tiers"."start_at"),
	CONSTRAINT "non_negative_price_override" CHECK ("pricing_tiers"."price_per_person_override" >= 0)
);
--> statement-breakpoint
CREATE TABLE "wallet_balances" (
	"user_id" text NOT NULL,
	"balance_type" "wallet_balance_type" NOT NULL,
	"amount" numeric(14, 2) DEFAULT '0.00' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "wallet_balances_user_id_balance_type_pk" PRIMARY KEY("user_id","balance_type"),
	CONSTRAINT "wallet_amount_non_negative" CHECK ("wallet_balances"."amount" >= 0)
);
--> statement-breakpoint
CREATE TABLE "audit_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_user_id" text,
	"action" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" text NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_generations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"surface" "ai_surface" NOT NULL,
	"model" text NOT NULL,
	"model_version" text NOT NULL,
	"prompt_template_hash" text NOT NULL,
	"input_fingerprint" text NOT NULL,
	"output" jsonb NOT NULL,
	"retrieval_set" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"citation_traces" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"requested_by_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_customer_user_id_users_id_fk" FOREIGN KEY ("customer_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_experience_id_experiences_id_fk" FOREIGN KEY ("experience_id") REFERENCES "public"."experiences"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_slot_id_availability_slots_id_fk" FOREIGN KEY ("slot_id") REFERENCES "public"."availability_slots"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wallet_balances" ADD CONSTRAINT "wallet_balances_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_generations" ADD CONSTRAINT "ai_generations_requested_by_user_id_users_id_fk" FOREIGN KEY ("requested_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "bookings_by_customer" ON "bookings" USING btree ("customer_user_id");--> statement-breakpoint
CREATE INDEX "bookings_by_experience" ON "bookings" USING btree ("experience_id");--> statement-breakpoint
CREATE INDEX "bookings_by_slot" ON "bookings" USING btree ("slot_id");--> statement-breakpoint
CREATE INDEX "bookings_by_state" ON "bookings" USING btree ("state");--> statement-breakpoint
CREATE UNIQUE INDEX "payments_razorpay_order_id_unique" ON "payments" USING btree ("razorpay_order_id") WHERE "payments"."razorpay_order_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "payments_by_booking" ON "payments" USING btree ("booking_id");--> statement-breakpoint
CREATE INDEX "commission_tiers_active_window" ON "commission_tiers" USING btree ("start_at","end_at");--> statement-breakpoint
CREATE INDEX "pricing_tiers_active_window" ON "pricing_tiers" USING btree ("start_at","end_at");--> statement-breakpoint
CREATE INDEX "audit_logs_by_entity" ON "audit_logs" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "audit_logs_by_actor" ON "audit_logs" USING btree ("actor_user_id");--> statement-breakpoint
CREATE INDEX "audit_logs_by_time" ON "audit_logs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "audit_logs_by_action" ON "audit_logs" USING btree ("action");