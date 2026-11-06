CREATE TABLE "suspensions" (
	"account_id" text PRIMARY KEY NOT NULL,
	"at" bigint NOT NULL,
	"until" bigint,
	"reason" text NOT NULL,
	"hide_profile" boolean NOT NULL
);
--> statement-breakpoint
ALTER TABLE "suspensions" ADD CONSTRAINT "suspensions_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;