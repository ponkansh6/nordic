#!/usr/bin/env tsx
/**
 * Environment validation script.
 * Checks that all required env vars are set and warns about optional ones.
 *
 * Usage: pnpm tsx scripts/check-env.ts
 * Or add as "check-env" script in package.json.
 */

/* eslint-disable no-console */

const REQUIRED = {
  TURSO_DATABASE_URL: "Turso DB connection string",
  TURSO_AUTH_TOKEN: "Turso DB auth token",
  GOOGLE_API_KEY: "Google API key for article summaries and Nordic relevance scoring",
} as const;

const OPTIONAL = {
  CRON_SECRET: "Bearer secret for the scheduled Vercel ingest route",
} as const;

let hasError = false;

console.log("=== Environment Validation ===\n");

// Check required
for (const [key, desc] of Object.entries(REQUIRED)) {
  if (process.env[key]) {
    const val = process.env[key]!;
    const masked = val.length > 8 ? val.slice(0, 4) + "..." + val.slice(-4) : "***";
    console.log(`  ✅ ${key} = ${masked}  (${desc})`);
  } else {
    console.log(`  ❌ ${key} is MISSING  (${desc})`);
    hasError = true;
  }
}

// Check optional
for (const [key, desc] of Object.entries(OPTIONAL)) {
  if (process.env[key]) {
    const val = process.env[key]!;
    const masked = val.length > 8 ? val.slice(0, 4) + "..." + val.slice(-4) : "***";
    console.log(`  ◻️  ${key} = ${masked}  (${desc})`);
  } else {
    console.log(`  ◻️  ${key} not set  (${desc})`);
  }
}

console.log(
  `\n${hasError ? "❌ Some required env vars are missing" : "✅ All required env vars present"}`,
);

if (hasError) {
  process.exit(1);
}
