import { describe, expect, test } from "vitest";
import { Table } from "drizzle-orm";
import { db } from "@/lib/db";
import * as schema from "@/lib/db/nordic-schema";
import { readFileSync, readdirSync } from "node:fs";
import { resolve, join } from "node:path";

function getSchemaTables(): { table: Table; name: string }[] {
  return Object.values(schema)
    .filter((t: unknown): t is Table => t instanceof Table)
    .map((table) => ({
      table,
      // @ts-expect-error Table.Symbol exists at runtime
      name: (table as any)[Table.Symbol.Name] as string,
    }));
}

describe("schema consistency", () => {
  test("all Nordic tables should exist in the in-memory database", async () => {
    const tables = getSchemaTables();
    expect(tables.length, "Nordic schema should define tables").toBeGreaterThan(0);

    for (const { name } of tables) {
      await db.$client.execute(`SELECT 1 FROM ${name} LIMIT 1`);
    }
  });

  test("all Nordic tables should be created by Nordic migrations", async () => {
    const tables = getSchemaTables();
    const tableNames = tables.map((t) => t.name);

    const migrationsDir = resolve(__dirname, "../../src/lib/db/nordic-migrations");
    const files = readdirSync(migrationsDir).filter((f) => f.endsWith(".sql"));

    const createdTables: string[] = [];
    for (const file of files) {
      const content = readFileSync(join(migrationsDir, file), "utf-8");
      const matches = content.matchAll(/CREATE TABLE\s+(?:IF NOT EXISTS\s+)?["`]?(\w+)["`]?/gi);
      for (const m of matches) createdTables.push(m[1]);
    }

    for (const tableName of tableNames) {
      expect(createdTables, `Table ${tableName} not found in migrations`).toContain(tableName);
    }
  });

  test("all Nordic columns should exist in the in-memory database", async () => {
    const tables = getSchemaTables();

    for (const { table, name } of tables) {
      const expectedColumns = Object.values(table)
        .filter((val: any) => val && typeof val === "object" && "name" in val)
        .map((col: any) => col.name);

      const result = await db.$client.execute(`PRAGMA table_info(${name})`);
      const rows = Array.isArray(result) ? result : (result as any).rows || [];
      const actualColumns = rows.map((row: any) => row.name);

      for (const col of expectedColumns) {
        expect(actualColumns, `Column ${col} missing in table ${name}`).toContain(col);
      }
    }
  });

  test("starts with two source rows and no articles or job state", async () => {
    const sources = await db.$client.execute("SELECT count(*) AS n FROM nordic_sources");
    const articles = await db.$client.execute("SELECT count(*) AS n FROM nordic_articles");
    const states = await db.$client.execute("SELECT count(*) AS n FROM nordic_job_state");
    expect(Number(sources.rows[0]?.n)).toBe(2);
    expect(Number(articles.rows[0]?.n)).toBe(0);
    expect(Number(states.rows[0]?.n)).toBe(0);
  });
});
