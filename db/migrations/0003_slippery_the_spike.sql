CREATE TYPE "public"."wallet_balance_type" AS ENUM('outvers_credit', 'refund_balance');--> statement-breakpoint
CREATE TYPE "public"."ai_surface" AS ENUM('review_summary', 'listing_draft', 'inbox_reply', 'trip_planner');--> statement-breakpoint
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
ALTER TABLE "wallet_balances" ADD CONSTRAINT "wallet_balances_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_generations" ADD CONSTRAINT "ai_generations_requested_by_user_id_users_id_fk" FOREIGN KEY ("requested_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_logs_by_entity" ON "audit_logs" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "audit_logs_by_actor" ON "audit_logs" USING btree ("actor_user_id");--> statement-breakpoint
CREATE INDEX "audit_logs_by_time" ON "audit_logs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "audit_logs_by_action" ON "audit_logs" USING btree ("action");