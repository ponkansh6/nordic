import { unstable_cache } from "next/cache";
import { desc, eq, inArray } from "drizzle-orm";
import { db } from "./index";
import { nordicArticles, nordicSources } from "./schema";
import type { NordicArticleInput, NordicScore } from "../nordic/types";

export interface NordicArticleRow {
  id: number;
  title: string;
  url: string;
  publishedAt: string;
  summary: string | null;
  nordicRelevance: number | null;
  recency: number | null;
  score: number | null;
  reason: string | null;
  sourceId: string;
  sourceName: string;
}

async function queryNordicArticles(): Promise<NordicArticleRow[]> {
  return db
    .select({
      id: nordicArticles.id,
      title: nordicArticles.title,
      url: nordicArticles.url,
      publishedAt: nordicArticles.publishedAt,
      summary: nordicArticles.summary,
      nordicRelevance: nordicArticles.nordicRelevance,
      recency: nordicArticles.recency,
      score: nordicArticles.score,
      reason: nordicArticles.reason,
      sourceId: nordicSources.id,
      sourceName: nordicSources.name,
    })
    .from(nordicArticles)
    .innerJoin(nordicSources, eq(nordicArticles.sourceId, nordicSources.id))
    .orderBy(desc(nordicArticles.score), desc(nordicArticles.publishedAt));
}

export const getNordicArticlesCached = unstable_cache(queryNordicArticles, ["nordic-articles"], {
  tags: ["nordic-articles"],
  revalidate: 300,
});

export async function getKnownNordicArticleUrls(urls: string[]): Promise<Set<string>> {
  if (urls.length === 0) return new Set();
  const known = new Set<string>();
  for (let index = 0; index < urls.length; index += 200) {
    const rows = await db
      .select({ url: nordicArticles.url })
      .from(nordicArticles)
      .where(inArray(nordicArticles.url, urls.slice(index, index + 200)));
    for (const row of rows) known.add(row.url);
  }
  return known;
}

export async function insertNordicArticles(
  articles: Array<{
    candidate: NordicArticleInput;
    score: NordicScore;
    recency: number;
    composite: number;
  }>,
): Promise<Set<string>> {
  if (articles.length === 0) return new Set();
  const now = new Date().toISOString();
  const inserted = await db
    .insert(nordicArticles)
    .values(
      articles.map(({ candidate, score, recency, composite }) => ({
        sourceId: candidate.sourceId,
        url: candidate.url,
        title: candidate.title,
        description: candidate.description,
        urlToImage: candidate.urlToImage,
        publishedAt: candidate.publishedAt,
        summary: score.summary,
        nordicRelevance: score.nordicRelevance,
        recency,
        score: composite,
        reason: score.reason,
        scoredAt: now,
      })),
    )
    .onConflictDoNothing({ target: nordicArticles.url })
    .returning({ url: nordicArticles.url });
  return new Set(inserted.map((row) => row.url));
}
