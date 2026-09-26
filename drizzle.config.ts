import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./src/lib/db/nordic-schema.ts",
  out: "./src/lib/db/nordic-migrations",
  dialect: "turso",
  migrations: { table: "__drizzle_migrations_nordic" },
  dbCredentials: {
    url: process.env.TURSO_DATABASE_URL!,
    authToken: process.env.TURSO_AUTH_TOKEN!,
  },
});
