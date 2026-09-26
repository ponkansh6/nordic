import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NordicCandidate } from "@/lib/nordic/types";

const { callGemini } = vi.hoisted(() => ({ callGemini: vi.fn() }));
vi.mock("@/lib/llm/client", () => ({ callGemini }));

import { scoreNordicBatch } from "@/lib/nordic/score";

const candidate: NordicCandidate = {
  sourceId: "lumene",
  sourceName: "Lumene",
  title: "Nordic ingredients",
  url: "https://example.com/story",
  description: "Natural ingredients from the Nordic region",
  urlToImage: null,
  publishedAt: "2026-09-01T00:00:00.000Z",
};

describe("scoreNordicBatch", () => {
  beforeEach(() => callGemini.mockReset());

  it("does not call Gemini for an empty batch", async () => {
    await expect(scoreNordicBatch([])).resolves.toEqual([]);
    expect(callGemini).not.toHaveBeenCalled();
  });

  it("returns validated Japanese score records and sends article context", async () => {
    callGemini.mockResolvedValue(
      JSON.stringify({
        results: [
          {
            summary: "北欧由来の成分について紹介する記事です。",
            nordicRelevance: 8,
            reason: "自然由来の成分を扱っています。",
          },
        ],
      }),
    );

    await expect(scoreNordicBatch([candidate])).resolves.toEqual([
      {
        summary: "北欧由来の成分について紹介する記事です。",
        nordicRelevance: 8,
        reason: "自然由来の成分を扱っています。",
      },
    ]);
    const [prompt, maxTokens, timeout, temperature] = callGemini.mock.calls[0] ?? [];
    expect(prompt).toContain(candidate.title);
    expect(prompt).toContain(candidate.description);
    expect(maxTokens).toBeTypeOf("number");
    expect(timeout).toBe(15_000);
    expect(temperature).toBe(0);
  });

  it("rejects empty, invalid JSON, invalid score fields, and mismatched result counts", async () => {
    callGemini.mockResolvedValueOnce("");
    await expect(scoreNordicBatch([candidate])).rejects.toThrow("empty Nordic scoring response");

    callGemini.mockResolvedValueOnce("not json");
    await expect(scoreNordicBatch([candidate])).rejects.toThrow("invalid JSON");

    callGemini.mockResolvedValueOnce(
      JSON.stringify({ results: [{ summary: "", nordicRelevance: 11, reason: "" }] }),
    );
    await expect(scoreNordicBatch([candidate])).rejects.toThrow("invalid Nordic scores");

    callGemini.mockResolvedValueOnce(JSON.stringify({ results: [] }));
    await expect(scoreNordicBatch([candidate])).rejects.toThrow("returned 0 scores for 1 articles");
  });
});
