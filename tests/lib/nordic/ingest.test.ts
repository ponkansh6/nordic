import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { NordicCandidate, NordicScore } from "@/lib/nordic/types";

const mocks = vi.hoisted(() => {
  const sources = [
    {
      id: "design",
      name: "Design Stories",
      siteUrl: "https://design.example",
      feedUrl: "https://design.example/feed",
      articlePathPrefix: "/stories/",
    },
    {
      id: "lumene",
      name: "Lumene",
      siteUrl: "https://lumene.example",
      feedUrl: "https://lumene.example/feed",
      articlePathPrefix: "/news/",
    },
  ];
  return {
    sources,
    getKnownNordicArticleUrls: vi.fn(),
    insertNordicArticles: vi.fn(),
    fetchLatestFromSource: vi.fn(),
    scoreNordicBatch: vi.fn(),
    acquireIngestLease: vi.fn(),
    claimManualCooldown: vi.fn(),
    getManualCooldownUntil: vi.fn(),
    releaseIngestLease: vi.fn(),
    syncProductionDeployment: vi.fn(),
    revalidateTag: vi.fn(),
  };
});

vi.mock("next/cache", () => ({ revalidateTag: mocks.revalidateTag }));
vi.mock("@/lib/db/nordic", () => ({
  getKnownNordicArticleUrls: mocks.getKnownNordicArticleUrls,
  insertNordicArticles: mocks.insertNordicArticles,
}));
vi.mock("@/lib/nordic/sources", () => ({
  NORDIC_SOURCES: mocks.sources,
  fetchLatestFromSource: mocks.fetchLatestFromSource,
}));
vi.mock("@/lib/nordic/score", () => ({ scoreNordicBatch: mocks.scoreNordicBatch }));
vi.mock("@/lib/nordic/state", () => ({
  acquireIngestLease: mocks.acquireIngestLease,
  claimManualCooldown: mocks.claimManualCooldown,
  getManualCooldownUntil: mocks.getManualCooldownUntil,
  releaseIngestLease: mocks.releaseIngestLease,
  syncProductionDeployment: mocks.syncProductionDeployment,
}));

import { runNordicIngestion, triggerNordicIngestion } from "@/lib/nordic/ingest";

function candidate(
  sourceId: "design" | "lumene",
  title: string,
  publishedAt: string,
): NordicCandidate {
  const source = mocks.sources.find((item) => item.id === sourceId)!;
  return {
    sourceId,
    sourceName: source.name,
    title,
    url: `https://${sourceId}.example/${encodeURIComponent(title)}`,
    description: "An article about design, materials, and Nordic everyday life.",
    urlToImage: null,
    publishedAt,
  };
}

const goodScore: NordicScore = {
  summary: "北欧の素材と暮らしを紹介します。",
  nordicRelevance: 8,
  reason: "北欧のデザインを扱っています。",
};

describe("Nordic ingestion", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-26T00:00:00.000Z"));
    mocks.getKnownNordicArticleUrls.mockReset().mockResolvedValue(new Set());
    mocks.insertNordicArticles
      .mockReset()
      .mockImplementation(
        async (rows) =>
          new Set(rows.map((row: { candidate: NordicCandidate }) => row.candidate.url)),
      );
    mocks.fetchLatestFromSource.mockReset().mockResolvedValue([]);
    mocks.scoreNordicBatch
      .mockReset()
      .mockImplementation(async (items: NordicCandidate[]) => items.map(() => goodScore));
    mocks.acquireIngestLease.mockReset().mockResolvedValue("lease-token");
    mocks.claimManualCooldown
      .mockReset()
      .mockResolvedValue({ claimed: true, cooldownUntil: "2026-09-26T12:00:00.000Z" });
    mocks.getManualCooldownUntil.mockReset().mockResolvedValue(null);
    mocks.releaseIngestLease.mockReset().mockResolvedValue(undefined);
    mocks.syncProductionDeployment.mockReset().mockResolvedValue(undefined);
    mocks.revalidateTag.mockReset();
  });

  afterEach(() => vi.useRealTimers());

  it("deduplicates URLs and saves LLM scores with 80/20 recency weighting", async () => {
    const yesterday = candidate("design", "Yesterday", "2026-09-25T00:00:00.000Z");
    const old = candidate("lumene", "Older", "2026-09-19T00:00:00.000Z");
    const ancient = candidate("lumene", "Ancient", "2026-07-01T00:00:00.000Z");
    mocks.fetchLatestFromSource
      .mockResolvedValueOnce([yesterday, { ...yesterday, url: `${yesterday.url}#top` }])
      .mockResolvedValueOnce([old, ancient]);
    mocks.insertNordicArticles.mockResolvedValue(new Set([yesterday.url, old.url, ancient.url]));

    const result = await runNordicIngestion();

    expect(result).toMatchObject({
      fetched: 4,
      newCandidates: 3,
      saved: 3,
      duplicate: 1,
      errors: [],
    });
    expect(mocks.scoreNordicBatch).toHaveBeenCalledWith([yesterday, old, ancient]);
    const rows = mocks.insertNordicArticles.mock.calls[0]?.[0] as Array<{
      candidate: NordicCandidate;
      recency: number;
      composite: number;
    }>;
    expect(rows.map((row) => row.recency)).toEqual([10, 6, 0]);
    expect(rows.map((row) => row.composite)).toEqual([8.4, 7.6, 6.4]);
    expect(result.sources.map((source) => source.saved)).toEqual([1, 2]);
    expect(mocks.revalidateTag).toHaveBeenCalledWith("nordic-articles", "max");
  });

  it("filters known URLs and records source fetch errors", async () => {
    const known = candidate("design", "Known", "2026-09-25T00:00:00.000Z");
    mocks.fetchLatestFromSource
      .mockResolvedValueOnce([known])
      .mockRejectedValueOnce(new Error("Lumene unavailable"));
    mocks.getKnownNordicArticleUrls.mockResolvedValue(new Set([known.url]));

    const result = await runNordicIngestion();

    expect(result).toMatchObject({ fetched: 1, newCandidates: 0, saved: 0, duplicate: 1 });
    expect(result.errors).toContain("Lumene unavailable");
    expect(mocks.scoreNordicBatch).not.toHaveBeenCalled();
    expect(mocks.insertNordicArticles).not.toHaveBeenCalled();
  });

  it("keeps successful score batches when another batch fails", async () => {
    const candidates = Array.from({ length: 21 }, (_, index) =>
      candidate("design", `Story ${index}`, "2026-09-25T00:00:00.000Z"),
    );
    mocks.fetchLatestFromSource.mockResolvedValueOnce(candidates).mockResolvedValueOnce([]);
    mocks.scoreNordicBatch
      .mockResolvedValueOnce(Array.from({ length: 20 }, () => goodScore))
      .mockRejectedValueOnce(new Error("LLM timeout"));
    mocks.insertNordicArticles.mockImplementation(
      async (rows) => new Set(rows.map((row: { candidate: NordicCandidate }) => row.candidate.url)),
    );

    const result = await runNordicIngestion();

    expect(result.saved).toBe(20);
    expect(result.errors).toContain("LLM timeout");
    expect(mocks.scoreNordicBatch).toHaveBeenCalledTimes(2);
  });

  it("reports database insertion failures and ignores malformed article URLs", async () => {
    const valid = candidate("design", "Valid", "bad-date");
    const malformed = {
      ...candidate("design", "Invalid", "2026-09-25T00:00:00.000Z"),
      url: "not a URL",
    };
    mocks.fetchLatestFromSource.mockResolvedValueOnce([valid, malformed]).mockResolvedValueOnce([]);
    mocks.insertNordicArticles.mockRejectedValue(new Error("database unavailable"));

    const result = await runNordicIngestion();

    expect(result.newCandidates).toBe(1);
    expect(result.saved).toBe(0);
    expect(result.errors).toContain("database unavailable");
  });

  it("handles lease, cooldown, completion, and error outcomes for triggers", async () => {
    mocks.acquireIngestLease.mockResolvedValueOnce(null);
    mocks.getManualCooldownUntil.mockResolvedValueOnce("2026-09-26T12:00:00.000Z");
    await expect(triggerNordicIngestion("cron")).resolves.toEqual({
      status: "busy",
      cooldownUntil: "2026-09-26T12:00:00.000Z",
    });

    mocks.acquireIngestLease.mockResolvedValueOnce("cooldown-lease");
    mocks.claimManualCooldown.mockResolvedValueOnce({
      claimed: false,
      cooldownUntil: "2026-09-27T00:00:00.000Z",
    });
    await expect(triggerNordicIngestion("manual")).resolves.toEqual({
      status: "cooldown",
      cooldownUntil: "2026-09-27T00:00:00.000Z",
    });
    expect(mocks.releaseIngestLease).toHaveBeenCalledWith("cooldown-lease");

    mocks.acquireIngestLease.mockResolvedValueOnce("success-lease");
    await expect(triggerNordicIngestion("cron")).resolves.toMatchObject({
      status: "completed",
      result: { cooldownUntil: null },
    });
    expect(mocks.releaseIngestLease).toHaveBeenCalledWith("success-lease");

    mocks.acquireIngestLease.mockResolvedValueOnce("error-lease");
    mocks.claimManualCooldown.mockRejectedValueOnce(new Error("state database unavailable"));
    await expect(triggerNordicIngestion("manual")).resolves.toMatchObject({
      status: "failed",
      error: "state database unavailable",
    });
    expect(mocks.releaseIngestLease).toHaveBeenCalledWith("error-lease");
  });
});
