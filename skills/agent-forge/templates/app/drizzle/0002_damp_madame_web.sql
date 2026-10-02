ALTER TABLE "conversations" ADD COLUMN "reference" text DEFAULT 'support' NOT NULL;--> statement-breakpoint
ALTER TABLE "runs" ADD COLUMN "reference" text DEFAULT 'support' NOT NULL;