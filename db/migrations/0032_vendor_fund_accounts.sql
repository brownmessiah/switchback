ALTER TABLE "vendor_profiles" ADD COLUMN "razorpay_contact_id" text;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "vendor_fund_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"vendor_user_id" text NOT NULL,
	"destination_fingerprint" text NOT NULL,
	"razorpay_fund_account_id" text NOT NULL,
	"cooling_off_until" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "vendor_fund_accounts_vendor_user_id_users_id_fk" FOREIGN KEY ("vendor_user_id") REFERENCES "users"("id") ON DELETE cascade ON UPDATE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "vendor_fund_accounts_vendor_destination" ON "vendor_fund_accounts" USING btree ("vendor_user_id","destination_fingerprint");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "vendor_fund_accounts_by_vendor" ON "vendor_fund_accounts" USING btree ("vendor_user_id");
