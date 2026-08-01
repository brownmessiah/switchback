-- Vendor KYC evidence (ADR-0007 interim path).
--
-- ADR-0007's Tier-2 gate assumes Aadhaar OTP eKYC. That integration does not
-- exist, so the ADR's own documented fallback is now the LIVE path: PAN +
-- government ID + selfie, reviewed manually by an admin. Until this table
-- there was nowhere to put that evidence -- the onboarding wizard said as much
-- out loud ("document upload will be available when external services are
-- connected"), and the admin Evidence Cockpit rendered fields no vendor UI
-- could ever write.
--
-- A dedicated table rather than reusing `media_assets`, for one decisive
-- reason: media_assets.url is NOT NULL, and a private document HAS no URL.
-- These objects live in a bucket with no public IAM and are read only through
-- short-lived signed URLs, so storing a durable link would either be a lie
-- (empty string) or a leak. Keeping the column out makes the mistake
-- unrepresentable. Retention/lifecycle also differ (see the 3-year rule on the
-- bucket in terraform/storage.tf).
--
-- Hand-authored per the repo migration policy (never drizzle-kit generate).
-- MUST stay in lockstep with db/schema/vendor-kyc-documents.ts (the drizzle
-- definition also drives the e2e DB via drizzle-kit push).

DO $$ BEGIN
  CREATE TYPE "vendor_kyc_document_kind" AS ENUM (
    'government_id',
    'selfie',
    'pan_card',
    'business_proof'
  );
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "vendor_kyc_documents" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "vendor_user_id" text NOT NULL,
  "kind" "vendor_kyc_document_kind" NOT NULL,
  -- Key into the PRIVATE bucket. Deliberately no "url" column.
  "storage_key" text NOT NULL,
  "content_type" text NOT NULL,
  "size_bytes" integer NOT NULL,
  "original_filename" text,
  "uploaded_by" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "vendor_kyc_documents_vendor_user_id_fk"
    FOREIGN KEY ("vendor_user_id") REFERENCES "vendor_profiles"("user_id") ON DELETE CASCADE,
  CONSTRAINT "vendor_kyc_documents_uploaded_by_fk"
    FOREIGN KEY ("uploaded_by") REFERENCES "users"("id") ON DELETE RESTRICT
);
--> statement-breakpoint

-- The admin Evidence Cockpit reads "every document for this Vendor".
CREATE INDEX IF NOT EXISTS "vendor_kyc_documents_by_vendor"
  ON "vendor_kyc_documents" ("vendor_user_id");
--> statement-breakpoint

-- A storage key identifies exactly one object; never register it twice.
CREATE UNIQUE INDEX IF NOT EXISTS "vendor_kyc_documents_storage_key_unique"
  ON "vendor_kyc_documents" ("storage_key");
