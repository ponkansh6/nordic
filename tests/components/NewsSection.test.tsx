// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { NewsSection } from "@/components/news/news-section";
import type { Article } from "@/components/article/article-list";
import "@testing-library/jest-dom/vitest";

const article: Article = {
  id: 1,
  title: "Nordic furniture story",
  url: "https://example.com/story",
  publishedAt: "2026-09-25T00:00:00.000Z",
  sourceName: "Dezeen · Finland",
  sourceId: "dezeen-finland",
  summary: "北欧の家具と素材を紹介します。",
  nordicRelevance: 8,
  recency: 10,
  score: 8.4,
  reason: "北欧のデザインを扱います。",
};

describe("NewsSection", () => {
  it("shows the empty state and article count", () => {
    render(<NewsSection articles={[]} />);
    expect(screen.getByRole("heading", { name: "北欧デザインの記事 (0件)" })).toBeInTheDocument();
    expect(screen.getByText("まだ記事がありません")).toBeInTheDocument();
  });

  it("renders article rows and the total count", () => {
    render(<NewsSection articles={[article]} />);
    expect(screen.getByText("Nordic furniture story")).toBeInTheDocument();
    expect(screen.getByText("(1件)")).toBeInTheDocument();
  });
});
