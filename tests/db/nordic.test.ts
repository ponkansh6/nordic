import { describe, expect, it, vi } from "vitest";
vi.mock("next/cache", () => ({ unstable_cache: (callback: () => unknown) => callback }));
import { db } from "@/lib/db";
import {
  getKnownNordicArticleUrls,
  getNordicArticlesCached,
  insertNordicArticles,
} from "@/lib/db/nordic";
import { nordicArticles } from "@/lib/db/schema";
import type { NordicScore } from "@/lib/nordic/types";

const score: NordicScore = {
  summary: "北欧デザインの背景を紹介します。",
  nordicRelevance: 8,
  reason: "北欧の家具と素材を解説しています。",
};

describe("Nordic article data access", () => {
  it("handles empty lookups and inserts, and chunks URL lookups", async () => {
    await expect(getKnownNordicArticleUrls([])).resolves.toEqual(new Set());
    await expect(insertNordicArticles([])).resolves.toEqual(new Set());

    const urls = Array.from({ length: 201 }, (_, index) => `https://nordic.test/story/${index}`);
    await db.insert(nordicArticles).values({
      sourceId: "finnish-design-shop",
      url: urls[200]!,
      title: "Chunk boundary article",
      publishedAt: "2026-09-25T00:00:00.000Z",
    });
    await expect(getKnownNordicArticleUrls(urls)).resolves.toEqual(new Set([urls[200]]));
  });

  it("inserts scored articles once and returns article rows ordered by score", async () => {
    const unique = `https://nordic.test/db-${crypto.randomUUID()}`;
    const other = `https://nordic.test/db-${crypto.randomUUID()}`;
    const candidates = [
      {
        candidate: {
          sourceId: "finnish-design-shop",
          sourceName: "Finnish Design Shop · Design Stories",
          url: unique,
          title: "High score",
          description: "Description",
          urlToImage: null,
          publishedAt: "2026-09-25T00:00:00.000Z",
        },
        score,
        recency: 10,
        composite: 8.4,
      },
      {
        candidate: {
          sourceId: "lumene",
          sourceName: "Lumene",
          url: other,
          title: "Lower score",
          description: null,
          urlToImage: "https://nordic.test/image.jpg",
          publishedAt: "2026-09-24T00:00:00.000Z",
        },
        score: { ...score, nordicRelevance: 6 },
        recency: 4,
        composite: 5.6,
      },
      {
        candidate: {
          sourceId: "finnish-design-shop",
          sourceName: "Finnish Design Shop · Design Stories",
          url: unique,
          title: "Duplicate",
          description: null,
          urlToImage: null,
          publishedAt: "2026-09-25T00:00:00.000Z",
        },
        score,
        recency: 10,
        composite: 8.4,
      },
    ];

    await expect(insertNordicArticles(candidates)).resolves.toEqual(new Set([unique, other]));
    await expect(insertNordicArticles(candidates)).resolves.toEqual(new Set());
    await expect(getKnownNordicArticleUrls([unique, other])).resolves.toEqual(
      new Set([unique, other]),
    );
    const rows = await getNordicArticlesCached();
    expect(rows.find((row) => row.url === unique)).toMatchObject({
      title: "High score",
      sourceName: "Finnish Design Shop · Design Stories",
      summary: score.summary,
      nordicRelevance: 8,
      recency: 10,
      score: 8.4,
      reason: score.reason,
    });
    expect(rows.findIndex((row) => row.url === unique)).toBeLessThan(
      rows.findIndex((row) => row.url === other),
    );
  });

  it("queries known Nordic article URLs in separate batches", async () => {
    const urls = Array.from(
      { length: 201 },
      (_, index) => `https://nordic.test/batch-${crypto.randomUUID()}-${index}`,
    );
    await db.insert(nordicArticles).values({
      sourceId: "lumene",
      url: urls[0]!,
      title: "First batch",
      publishedAt: "2026-09-25T00:00:00.000Z",
    });
    await db.insert(nordicArticles).values({
      sourceId: "lumene",
      url: urls[200]!,
      title: "Second batch",
      publishedAt: "2026-09-25T00:00:00.000Z",
    });
    await expect(getKnownNordicArticleUrls(urls)).resolves.toEqual(new Set([urls[0], urls[200]]));
  });
});
