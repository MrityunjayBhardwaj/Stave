import { defineConfig } from "drizzle-kit";

// #2352 — `pnpm db:generate` turns src/db/schema.ts into the next SQL migration
// in ./drizzle (committed). Migrations are APPLIED by scripts/db-migrate.mjs
// (`pnpm db:migrate`), and in dev and tests automatically on first use
// (src/db/client.ts), never by drizzle-kit itself.
export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema.ts",
  out: "./drizzle",
});
