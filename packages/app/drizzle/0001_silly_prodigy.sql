ALTER TABLE "entries" ADD COLUMN "purged_at" bigint;--> statement-breakpoint
-- #2401: entries removed before this had their files deleted and private columns cleared already.
UPDATE "entries" SET "purged_at" = "removed_at" WHERE "removed_at" IS NOT NULL;
