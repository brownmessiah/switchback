CREATE TYPE "public"."aadhaar_gender_verified" AS ENUM('female', 'male', 'other', 'unverified');--> statement-breakpoint
CREATE TYPE "public"."kyc_tier" AS ENUM('phone', 'identity', 'business');--> statement-breakpoint
CREATE TYPE "public"."payout_method" AS ENUM('upi', 'bank_account');--> statement-breakpoint
CREATE TABLE "users" (
	"id" text PRIMARY KEY NOT NULL,
	"email" text,
	"email_verified" boolean DEFAULT false NOT NULL,
	"phone" text,
	"phone_verified" boolean DEFAULT false NOT NULL,
	"name" text,
	"image" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email"),
	CONSTRAINT "users_phone_unique" UNIQUE("phone")
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
ALTER TABLE "customer_profiles" ADD CONSTRAINT "customer_profiles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vendor_profiles" ADD CONSTRAINT "vendor_profiles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "admin_profiles" ADD CONSTRAINT "admin_profiles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "admin_profiles" ADD CONSTRAINT "admin_profiles_invited_by_user_id_users_id_fk" FOREIGN KEY ("invited_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;