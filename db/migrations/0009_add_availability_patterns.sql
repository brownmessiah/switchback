CREATE TABLE IF NOT EXISTS "availability_patterns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"experience_id" uuid NOT NULL,
	"day_of_week" integer NOT NULL,
	"start_time" text NOT NULL,
	"end_time" text NOT NULL,
	"capacity" integer NOT NULL,
	"effective_from" date,
	"effective_until" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "day_of_week_range" CHECK ("availability_patterns"."day_of_week" >= 0 AND "availability_patterns"."day_of_week" <= 6),
	CONSTRAINT "pattern_positive_capacity" CHECK ("availability_patterns"."capacity" > 0),
	CONSTRAINT "effective_range_ordered" CHECK ("availability_patterns"."effective_from" IS NULL OR "availability_patterns"."effective_until" IS NULL OR "availability_patterns"."effective_until" >= "availability_patterns"."effective_from")
);
--> statement-breakpoint
ALTER TABLE "availability_patterns" ADD CONSTRAINT "availability_patterns_experience_id_experiences_id_fk" FOREIGN KEY ("experience_id") REFERENCES "public"."experiences"("id") ON DELETE cascade ON UPDATE no action;
