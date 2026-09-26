import { revalidateTag } from "next/cache";
import { getKnownNordicArticleUrls, insertNordicArticles } from "../db/nordic";
import { NORDIC_SOURCES, fetchLatestFromSource } from "./sources";
import { scoreNordicBatch } from "./score";
import type { NordicCandidate, NordicScore } from "./types";
import {
  acquireIngestLease,
  claimManualCooldown,
  getManualCooldownUntil,
  releaseIngestLease,
  syncProductionDeployment,
} from "./state";

export type IngestTrigger = "manual" | "cron";

export interface NordicIngestResult {
  fetched: number;
  newCandidates: number;
  saved: number;
  duplicate: number;
  cooldownUntil: string | null;
  sources: Array<{ source: string; fetched: number; newCandidates: number; saved: number }>;
  errors: string[];
}

export type TriggerResult =
  | { status: "completed"; result: NordicIngestResult }
  | { status: "cooldown"; cooldownUntil: string | null }
  | { status: "busy"; cooldownUntil: string | null }
  | { status: "failed"; error: string; cooldownUntil: string | null };

const ARTICLES_PER_SOURCE = 20;
const SCORING_BATCH_SIZE = 20;

function recencyScore(publishedAt: string, now = Date.now()): number {
  const published = new Date(publishedAt).getTime();
  if (!Number.isFinite(published) || published > now) return 0;
  const days = (now - published) / 86_400_000;
  if (days <= 1) return 10;
  if (days <= 3) return 8;
  if (days <= 7) return 6;
  if (days <= 14) return 4;
  if (days <= 30) return 2;
  return 0;
}

function uniqueCandidates(items: NordicCandidate[]): NordicCandidate[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    try {
      const url = new URL(item.url);
      url.hash = "";
      const key = url.href;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    } catch {
      return false;
    }
  });
}

async function scoreInBatches(
  candidates: NordicCandidate[],
): Promise<{ scores: Map<string, NordicScore>; errors: string[] }> {
  const batches: NordicCandidate[][] = [];
  for (let index = 0; index < candidates.length; index += SCORING_BATCH_SIZE) {
    batches.push(candidates.slice(index, index + SCORING_BATCH_SIZE));
  }
  const scored = new Map<string, NordicScore>();
  const settled = await Promise.allSettled(
    batches.map(async (batch) => ({ batch, scores: await scoreNordicBatch(batch) })),
  );
  const errors: string[] = [];
  for (let index = 0; index < settled.length; index += 1) {
    const entry = settled[index];
    if (!entry) continue;
    if (entry.status === "rejected") {
      errors.push(entry.reason instanceof Error ? entry.reason.message : String(entry.reason));
      continue;
    }
    entry.value.batch.forEach((candidate, itemIndex) => {
      const score = entry.value.scores[itemIndex];
      if (score) scored.set(candidate.url, score);
    });
  }
  return { scores: scored, errors };
}

export async function runNordicIngestion(): Promise<NordicIngestResult> {
  const sourceResults = await Promise.allSettled(
    NORDIC_SOURCES.map(async (source) => ({
      source,
      candidates: await fetchLatestFromSource(source, ARTICLES_PER_SOURCE),
    })),
  );
  const errors: string[] = [];
  const perSource = NORDIC_SOURCES.map((source) => ({
    source: source.name,
    fetched: 0,
    newCandidates: 0,
    saved: 0,
  }));
  const candidates: NordicCandidate[] = [];

  for (let index = 0; index < sourceResults.length; index += 1) {
    const response = sourceResults[index];
    const stats = perSource[index];
    if (!response || !stats) continue;
    if (response.status === "rejected") {
      errors.push(
        response.reason instanceof Error ? response.reason.message : String(response.reason),
      );
      continue;
    }
    stats.fetched = response.value.candidates.length;
    candidates.push(...response.value.candidates);
  }

  const unique = uniqueCandidates(candidates);
  const known = await getKnownNordicArticleUrls(unique.map((candidate) => candidate.url));
  const newCandidates = unique.filter((candidate) => !known.has(candidate.url));
  for (const stats of perSource) {
    stats.newCandidates = newCandidates.filter(
      (candidate) => candidate.sourceName === stats.source,
    ).length;
  }

  let saved = 0;
  if (newCandidates.length > 0) {
    try {
      const scoring = await scoreInBatches(newCandidates);
      errors.push(...scoring.errors);
      const scoredRows = newCandidates.flatMap((candidate) => {
        const score = scoring.scores.get(candidate.url);
        if (!score) return [];
        const recency = recencyScore(candidate.publishedAt);
        const composite = Math.round((score.nordicRelevance * 0.8 + recency * 0.2) * 100) / 100;
        return [{ candidate, score, recency, composite }];
      });
      const insertedUrls = await insertNordicArticles(scoredRows);
      saved = insertedUrls.size;
      for (const stats of perSource) {
        stats.saved = scoredRows.filter(
          (row) => row.candidate.sourceName === stats.source && insertedUrls.has(row.candidate.url),
        ).length;
      }
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
    }
  }

  revalidateTag("nordic-articles", "max");
  return {
    fetched: perSource.reduce((total, source) => total + source.fetched, 0),
    newCandidates: newCandidates.length,
    saved,
    duplicate: Math.max(0, candidates.length - unique.length) + known.size,
    cooldownUntil: null,
    sources: perSource,
    errors,
  };
}

export async function triggerNordicIngestion(trigger: IngestTrigger): Promise<TriggerResult> {
  await syncProductionDeployment();
  const leaseToken = await acquireIngestLease();
  if (!leaseToken) return { status: "busy", cooldownUntil: await getManualCooldownUntil() };

  let cooldownUntil: string | null = null;
  try {
    if (trigger === "manual") {
      const claim = await claimManualCooldown();
      cooldownUntil = claim.cooldownUntil;
      if (!claim.claimed) return { status: "cooldown", cooldownUntil };
    }

    const result = await runNordicIngestion();
    result.cooldownUntil = cooldownUntil;
    return { status: "completed", result };
  } catch (error) {
    return {
      status: "failed",
      error: error instanceof Error ? error.message : String(error),
      cooldownUntil: cooldownUntil ?? (await getManualCooldownUntil()),
    };
  } finally {
    await releaseIngestLease(leaseToken);
  }
}
