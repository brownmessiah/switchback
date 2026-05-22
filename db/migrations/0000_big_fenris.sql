CREATE TYPE "public"."aadhaar_gender_verified" AS ENUM('female', 'male', 'other', 'unverified');--> statement-breakpoint
CREATE TYPE "public"."kyc_tier" AS ENUM('phone', 'identity', 'business');--> statement-breakpoint
CREATE TYPE "public"."payout_method" AS ENUM('upi', 'bank_account');--> statement-breakpoint
CREATE TYPE "public"."cancellation_preset" AS ENUM('flexible', 'moderate', 'strict', 'custom');--> statement-breakpoint
CREATE TYPE "public"."experience_status" AS ENUM('draft', 'pending_review', 'published', 'paused', 'archived');--> statement-breakpoint
CREATE TYPE "public"."payment_mode" AS ENUM('full_upfront', 'partial_pay', 'reserve_now_pay_later');--> statement-breakpoint
CREATE TYPE "public"."slot_status" AS ENUM('open', 'sold_out', 'closed');--> statement-breakpoint
CREATE TYPE "public"."closure_source" AS ENUM('admin', 'vendor');--> statement-breakpoint
CREATE TYPE "public"."slug_entity_type" AS ENUM('experience', 'vendor', 'combo');--> statement-breakpoint
CREATE TYPE "public"."booking_state" AS ENUM('confirmed', 'awaiting_completion', 'completed', 'disputed', 'cancelled_by_customer', 'cancelled_by_vendor', 'cancelled_post_experience');--> statement-breakpoint
CREATE TYPE "public"."payment_mode_booking" AS ENUM('full_upfront', 'partial_pay', 'reserve_now_pay_later');--> statement-breakpoint
CREATE TYPE "public"."capture_trigger" AS ENUM('booking_create', 'auto_capture_t_minus_24h', 'escrow_full_capture', 'manual_admin', 'refund_reverse');--> statement-breakpoint
CREATE TYPE "public"."wallet_balance_type" AS ENUM('outvers_credit', 'refund_balance');--> statement-breakpoint
CREATE TYPE "public"."ai_surface" AS ENUM('review_summary', 'listing_draft', 'inbox_reply', 'trip_planner');--> statement-breakpoint
CREATE TABLE "users" (
	"id" text PRIMARY KEY NOT NULL,
	"email" text,
	"email_verified" boolean DEFAULT false NOT NULL,
	"phone_number" text,
	"phone_number_verified" boolean DEFAULT false NOT NULL,
	"name" text,
	"image" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email"),
	CONSTRAINT "users_phone_number_unique" UNIQUE("phone_number")
);
--> statement-breakpoint
CREATE TABLE "accounts" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"account_id" text NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp with time zone,
	"refresh_token_expires_at" timestamp with time zone,
	"scope" text,
	"password" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"token" text NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sessions_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "verifications" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "customer_profiles" (
	"user_id" text PRIMARY KEY NOT NULL,
	"wishlist" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"default_address" jsonb,
	"preferred_language" text DEFAULT 'en' NOT NULL,
	"aadhaar_gender_verified" "aadhaar_gender_verified" DEFAULT 'unverified' NOT NULL,
	"trusted_contact_name" text,
	"trusted_contact_phone" text,
	"trusted_contact_relationship" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "vendor_profiles" (
	"user_id" text PRIMARY KEY NOT NULL,
	"business_name" text NOT NULL,
	"slug" text NOT NULL,
	"kyc_tier" "kyc_tier" DEFAULT 'phone' NOT NULL,
	"pan" text,
	"gstin" text,
	"udyam_id" text,
	"aadhaar_verified_at" timestamp with time zone,
	"video_call_verified_at" timestamp with time zone,
	"commission_rate" numeric(5, 2) DEFAULT '20.00' NOT NULL,
	"payout_method" "payout_method",
	"payout_destination" jsonb,
	"payout_destination_changed_at" timestamp with time zone,
	"manual_payouts_remaining" integer DEFAULT 3 NOT NULL,
	"response_time_sla_score" numeric(5, 2) DEFAULT '100.00' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "vendor_profiles_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "admin_profiles" (
	"user_id" text PRIMARY KEY NOT NULL,
	"permissions" text[] DEFAULT '{}' NOT NULL,
	"invited_by_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "experiences" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"vendor_user_id" text NOT NULL,
	"slug" text NOT NULL,
	"title" text NOT NULL,
	"short_description" text,
	"long_description" text,
	"is_combo" boolean DEFAULT false NOT NULL,
	"combo_constituents" uuid[],
	"commission_rate_override" numeric(5, 2),
	"cancellation_preset" "cancellation_preset" NOT NULL,
	"cancellation_policy_text" text,
	"payment_modes_allowed" "payment_mode"[] NOT NULL,
	"price_per_person_1_2" numeric(12, 2) NOT NULL,
	"price_per_person_3_5" numeric(12, 2) NOT NULL,
	"price_per_person_6_plus" numeric(12, 2) NOT NULL,
	"required_permits" text[] DEFAULT '{}' NOT NULL,
	"requires_safety_stack" boolean DEFAULT false NOT NULL,
	"region_slug" text NOT NULL,
	"activity_slug" text NOT NULL,
	"status" "experience_status" DEFAULT 'draft' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "experiences_slug_unique" UNIQUE("slug"),
	CONSTRAINT "combo_has_constituents" CHECK (("experiences"."is_combo" = false) OR (COALESCE(array_length("experiences"."combo_constituents", 1), 0) >= 2)),
	CONSTRAINT "combo_slug_prefix" CHECK (("experiences"."is_combo" = true AND "experiences"."slug" LIKE 'combo-%') OR ("experiences"."is_combo" = false AND "experiences"."slug" NOT LIKE 'combo-%'))
);
--> statement-breakpoint
CREATE TABLE "availability_slots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"experience_id" uuid NOT NULL,
	"start_at" timestamp with time zone NOT NULL,
	"end_at" timestamp with time zone NOT NULL,
	"capacity" integer NOT NULL,
	"capacity_taken" integer DEFAULT 0 NOT NULL,
	"status" "slot_status" DEFAULT 'open' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "capacity_within_bounds" CHECK ("availability_slots"."capacity_taken" >= 0 AND "availability_slots"."capacity_taken" <= "availability_slots"."capacity"),
	CONSTRAINT "positive_capacity" CHECK ("availability_slots"."capacity" > 0),
	CONSTRAINT "slot_time_ordered" CHECK ("availability_slots"."end_at" > "availability_slots"."start_at")
);
--> statement-breakpoint
CREATE TABLE "region_closures" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"region_slug" text NOT NULL,
	"start_at" timestamp with time zone NOT NULL,
	"end_at" timestamp with time zone NOT NULL,
	"reason" text NOT NULL,
	"source" "closure_source" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "closure_time_ordered" CHECK ("region_closures"."end_at" > "region_closures"."start_at")
);
--> statement-breakpoint
CREATE TABLE "slug_redirects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entity_type" "slug_entity_type" NOT NULL,
	"entity_id" text NOT NULL,
	"old_slug" text NOT NULL,
	"retired_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
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
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_profiles" ADD CONSTRAINT "customer_profiles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vendor_profiles" ADD CONSTRAINT "vendor_profiles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "admin_profiles" ADD CONSTRAINT "admin_profiles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "admin_profiles" ADD CONSTRAINT "admin_profiles_invited_by_user_id_users_id_fk" FOREIGN KEY ("invited_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "experiences" ADD CONSTRAINT "experiences_vendor_user_id_vendor_profiles_user_id_fk" FOREIGN KEY ("vendor_user_id") REFERENCES "public"."vendor_profiles"("user_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "availability_slots" ADD CONSTRAINT "availability_slots_experience_id_experiences_id_fk" FOREIGN KEY ("experience_id") REFERENCES "public"."experiences"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_customer_user_id_users_id_fk" FOREIGN KEY ("customer_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_experience_id_experiences_id_fk" FOREIGN KEY ("experience_id") REFERENCES "public"."experiences"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_slot_id_availability_slots_id_fk" FOREIGN KEY ("slot_id") REFERENCES "public"."availability_slots"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wallet_balances" ADD CONSTRAINT "wallet_balances_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_generations" ADD CONSTRAINT "ai_generations_requested_by_user_id_users_id_fk" FOREIGN KEY ("requested_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "accounts_by_user" ON "accounts" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "accounts_by_provider" ON "accounts" USING btree ("provider_id","account_id");--> statement-breakpoint
CREATE INDEX "sessions_by_user" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "sessions_by_expires" ON "sessions" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "verifications_by_identifier" ON "verifications" USING btree ("identifier");--> statement-breakpoint
CREATE UNIQUE INDEX "availability_slots_experience_start" ON "availability_slots" USING btree ("experience_id","start_at");--> statement-breakpoint
CREATE UNIQUE INDEX "slug_redirects_unique_per_type" ON "slug_redirects" USING btree ("entity_type","old_slug");--> statement-breakpoint
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