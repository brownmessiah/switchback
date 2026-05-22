CREATE TYPE "public"."cancellation_preset" AS ENUM('flexible', 'moderate', 'strict', 'custom');--> statement-breakpoint
CREATE TYPE "public"."experience_status" AS ENUM('draft', 'pending_review', 'published', 'paused', 'archived');--> statement-breakpoint
CREATE TYPE "public"."payment_mode" AS ENUM('full_upfront', 'partial_pay', 'reserve_now_pay_later');--> statement-breakpoint
CREATE TYPE "public"."slot_status" AS ENUM('open', 'sold_out', 'closed');--> statement-breakpoint
CREATE TYPE "public"."closure_source" AS ENUM('admin', 'vendor');--> statement-breakpoint
CREATE TYPE "public"."slug_entity_type" AS ENUM('experience', 'vendor', 'combo');--> statement-breakpoint
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
ALTER TABLE "experiences" ADD CONSTRAINT "experiences_vendor_user_id_vendor_profiles_user_id_fk" FOREIGN KEY ("vendor_user_id") REFERENCES "public"."vendor_profiles"("user_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "availability_slots" ADD CONSTRAINT "availability_slots_experience_id_experiences_id_fk" FOREIGN KEY ("experience_id") REFERENCES "public"."experiences"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "availability_slots_experience_start" ON "availability_slots" USING btree ("experience_id","start_at");--> statement-breakpoint
CREATE UNIQUE INDEX "slug_redirects_unique_per_type" ON "slug_redirects" USING btree ("entity_type","old_slug");