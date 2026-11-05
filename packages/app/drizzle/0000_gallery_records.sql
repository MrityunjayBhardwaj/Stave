CREATE TABLE "account_links" (
	"account_id" text NOT NULL,
	"share_id" text NOT NULL,
	"project_name" text NOT NULL,
	"created_at" bigint NOT NULL,
	CONSTRAINT "account_links_account_id_share_id_pk" PRIMARY KEY("account_id","share_id")
);
--> statement-breakpoint
CREATE TABLE "accounts" (
	"id" text PRIMARY KEY NOT NULL,
	"provider" text NOT NULL,
	"provider_account_id" text NOT NULL,
	"author_id" text NOT NULL,
	"email" text NOT NULL,
	"verified" jsonb NOT NULL,
	"created_at" bigint NOT NULL,
	"updated_at" bigint NOT NULL,
	CONSTRAINT "accounts_provider_account_key" UNIQUE("provider","provider_account_id"),
	CONSTRAINT "accounts_author_id_key" UNIQUE("author_id")
);
--> statement-breakpoint
CREATE TABLE "admin_log" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"at" bigint NOT NULL,
	"admin_provider" text NOT NULL,
	"admin_account_id" text NOT NULL,
	"admin_name" text NOT NULL,
	"action" text NOT NULL,
	"target" text NOT NULL,
	"reason" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "author_keys" (
	"key_hash" text PRIMARY KEY NOT NULL,
	"author_id" text NOT NULL,
	CONSTRAINT "author_keys_author_id_key" UNIQUE("author_id")
);
--> statement-breakpoint
CREATE TABLE "authors" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"bio" text DEFAULT '' NOT NULL,
	"verified" jsonb,
	"email" text DEFAULT '' NOT NULL,
	"merged_into" text,
	"created_at" bigint NOT NULL,
	"updated_at" bigint NOT NULL,
	CONSTRAINT "authors_not_merged_into_self" CHECK ("authors"."merged_into" is distinct from "authors"."id")
);
--> statement-breakpoint
CREATE TABLE "collection_entries" (
	"collection_id" text NOT NULL,
	"entry_id" text NOT NULL,
	"position" integer NOT NULL,
	CONSTRAINT "collection_entries_collection_id_entry_id_pk" PRIMARY KEY("collection_id","entry_id"),
	CONSTRAINT "collection_entries_position_key" UNIQUE("collection_id","position")
);
--> statement-breakpoint
CREATE TABLE "collections" (
	"id" text PRIMARY KEY NOT NULL,
	"author_id" text NOT NULL,
	"title" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"created_at" bigint NOT NULL,
	"updated_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "entries" (
	"id" text PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"kind" text NOT NULL,
	"tags" text[] DEFAULT '{}'::text[] NOT NULL,
	"author_name" text NOT NULL,
	"author_id" text,
	"published_at" bigint NOT NULL,
	"file_count" integer NOT NULL,
	"has_thumbnail" boolean NOT NULL,
	"author_email" text DEFAULT '' NOT NULL,
	"manage_token_hash" text,
	"removed_at" bigint,
	"removed_by" text,
	CONSTRAINT "entries_kind_known" CHECK ("entries"."kind" in ('project', 'music', 'viz')),
	CONSTRAINT "entries_removed_by_known" CHECK ("entries"."removed_by" is null or "entries"."removed_by" in ('author', 'admin'))
);
--> statement-breakpoint
CREATE TABLE "rate_limits" (
	"key" text PRIMARY KEY NOT NULL,
	"window_start" bigint NOT NULL,
	"count" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reports" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"entry_id" text NOT NULL,
	"reason" text NOT NULL,
	"reported_at" bigint NOT NULL,
	"closed_at" bigint
);
--> statement-breakpoint
ALTER TABLE "account_links" ADD CONSTRAINT "account_links_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_author_id_authors_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."authors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "author_keys" ADD CONSTRAINT "author_keys_author_id_authors_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."authors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "authors" ADD CONSTRAINT "authors_merged_into_authors_id_fk" FOREIGN KEY ("merged_into") REFERENCES "public"."authors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "collection_entries" ADD CONSTRAINT "collection_entries_collection_id_collections_id_fk" FOREIGN KEY ("collection_id") REFERENCES "public"."collections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "collection_entries" ADD CONSTRAINT "collection_entries_entry_id_entries_id_fk" FOREIGN KEY ("entry_id") REFERENCES "public"."entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "collections" ADD CONSTRAINT "collections_author_id_authors_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."authors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entries" ADD CONSTRAINT "entries_author_id_authors_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."authors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reports" ADD CONSTRAINT "reports_entry_id_entries_id_fk" FOREIGN KEY ("entry_id") REFERENCES "public"."entries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "admin_log_newest_idx" ON "admin_log" USING btree ("at" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "collection_entries_entry_idx" ON "collection_entries" USING btree ("entry_id");--> statement-breakpoint
CREATE INDEX "collections_author_newest_idx" ON "collections" USING btree ("author_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "entries_live_newest_idx" ON "entries" USING btree ("published_at" DESC NULLS LAST) WHERE "entries"."removed_at" is null;--> statement-breakpoint
CREATE INDEX "entries_live_kind_newest_idx" ON "entries" USING btree ("kind","published_at" DESC NULLS LAST) WHERE "entries"."removed_at" is null;--> statement-breakpoint
CREATE INDEX "entries_author_newest_idx" ON "entries" USING btree ("author_id","published_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "reports_open_idx" ON "reports" USING btree ("entry_id","reported_at" DESC NULLS LAST) WHERE "reports"."closed_at" is null;