import { readFileSync, readdirSync } from "node:fs";
import { resolve, join } from "node:path";
import { beforeAll, vi } from "vitest";
import { db } from "../src/lib/db";

// Mock next/cache revalidateTag for tests (prevents "static generation store missing" errors)
vi.mock("next/cache", async (importOriginal) => {
  const actual = await importOriginal<typeof import("next/cache")>();
  return { ...actual, revalidateTag: vi.fn() };
});

// Load .env.local so Vitest has the same env as the Next.js dev server,
// EXCEPT the Turso credentials (by default). The `db` module falls back to an
// isolated in-memory SQLite when TURSO_DATABASE_URL is unset, which keeps tests
// deterministic and prevents them from touching the production database
// (e.g. scoring-polling.test.ts drops/recreates the `articles` table).
//
// When RUN_LIVE_TESTS=1, we DO load Turso credentials so live integration
// tests can read the real feed list from production. Live tests must avoid
// writing to the database.
const RUN_LIVE = process.env.RUN_LIVE_TESTS === "1";

const envPath = resolve(__dirname, "../.env.local");
try {
  const content = readFileSync(envPath, "utf-8");
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx < 0) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const value = trimmed.slice(eqIdx + 1).trim();
    // Skip Turso credentials unless running live integration tests.
    if (!RUN_LIVE && (key === "TURSO_DATABASE_URL" || key === "TURSO_AUTH_TOKEN")) continue;
    if (!process.env[key]) {
      process.env[key] = value;
    }
  }
} catch {
  // .env.local missing — tests relying on it will be skipped by their guards.
}

// Apply inherited and Nordic migrations to the in-memory DB BEFORE any test runs.
// This keeps both the preserved legacy schema and Nordic's isolated schema available
// without connecting the test process to Turso.
const migrationsDirs = [
  resolve(__dirname, "../src/lib/db/migrations"),
  resolve(__dirname, "../src/lib/db/nordic-migrations"),
];

async function applyMigrations() {
  for (const migrationsDir of migrationsDirs) {
    const files = readdirSync(migrationsDir)
      .filter((f) => f.endsWith(".sql"))
      .sort();
    for (const file of files) {
      const sql = readFileSync(join(migrationsDir, file), "utf-8");
      const statements = sql
        .split(/--> statement-breakpoint|;/)
        .map((s) => s.trim())
        .filter((s) => s !== "");
      for (const stmt of statements) {
        try {
          await db.$client.execute(stmt);
        } catch (e) {
          console.error(`[setup] Failed to apply migration ${file}: ${stmt}`);
          throw e;
        }
      }
    }
  }
}

beforeAll(async () => {
  await applyMigrations();
});
