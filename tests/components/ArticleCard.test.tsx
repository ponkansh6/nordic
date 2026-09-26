// @vitest-environment happy-dom
import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ArticleCard } from "@/components/article/article-card";
import "@testing-library/jest-dom/vitest";

const baseArticle = {
  id: 1,
  title: "テストカード",
  url: "https://example.com/story",
  sourceName: "Dezeen · Finland",
  sourceId: "dezeen-finland",
  publishedAt: "2026-03-30T00:00:00Z",
  summary: "北欧の素材と家具の背景を紹介する記事です。",
  nordicRelevance: 8,
  recency: 6,
  score: 7.6,
  reason: "デザインの背景を詳しく扱っています。",
};

describe("ArticleCard", () => {
  it("renders the original title, source, and Japanese summary", () => {
    render(<ArticleCard {...baseArticle} />);
    expect(screen.getByText("テストカード")).toBeInTheDocument();
    expect(screen.getByText("Dezeen · Finland")).toBeInTheDocument();
    expect(screen.getByText(baseArticle.summary)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "テストカード" })).toHaveAttribute(
      "href",
      baseArticle.url,
    );
  });

  it("shows the Nordic score breakdown and evaluation reason", async () => {
    render(<ArticleCard {...baseArticle} />);
    fireEvent.click(screen.getByRole("button", { name: /内訳を表示/ }));
    expect(await screen.findByText("北欧デザインとの関連性")).toBeInTheDocument();
    expect(screen.getByText("記事の新しさ")).toBeInTheDocument();

    const reasonButton = screen.getByRole("button", {
      name: `評価理由: ${baseArticle.reason}`,
    });
    fireEvent.click(reasonButton);
    expect(await screen.findAllByText(baseArticle.reason)).toHaveLength(2);
  });

  it("handles an invalid publication date", () => {
    render(<ArticleCard {...baseArticle} publishedAt="not-a-date" />);
    expect(screen.getByText("日付不明")).toBeInTheDocument();
  });
});
