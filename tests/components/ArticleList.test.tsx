// @vitest-environment happy-dom
import { describe, it, expect } from "vitest";
import { fireEvent, render, screen } from "../lib/test-utils";
import { ArticleList, type Article } from "@/components/article/article-list";
import "@testing-library/jest-dom/vitest";

const mockArticles: Article[] = [
  {
    id: 1,
    title: "テスト記事 1",
    url: "https://example.com/1",
    publishedAt: "2026-03-30T00:00:00Z",
    sourceName: "Finnish Design Shop",
    sourceId: "finnish-design-shop",
    summary: "これは要約1です。",
    nordicRelevance: 8.0,
    recency: 7.0,
    score: 8,
    reason: "関連性が高いため",
  },
  {
    id: 2,
    title: "テスト記事 2",
    url: "https://example.com/2",
    publishedAt: "2026-03-30T00:00:00Z",
    sourceName: "Lumene",
    sourceId: "lumene",
    summary: null,
    nordicRelevance: null,
    recency: null,
    score: null,
    reason: null,
  },
];

describe("ArticleList", () => {
  it("renders a list of articles with title, source, score, and summary", () => {
    render(<ArticleList articles={mockArticles} />);

    expect(screen.getByText("テスト記事 1")).toBeInTheDocument();
    expect(screen.getByText("Finnish Design Shop")).toBeInTheDocument();
    expect(screen.getByText("8.0")).toBeInTheDocument();
    expect(screen.getByText("これは要約1です。")).toBeInTheDocument();
  });

  it("handles article with null score gracefully", () => {
    render(<ArticleList articles={mockArticles} />);

    expect(screen.getByText("テスト記事 2")).toBeInTheDocument();
    expect(screen.getByText("Lumene")).toBeInTheDocument();
    // null score badge should display "--"
    expect(screen.getByText("--")).toBeInTheDocument();
  });

  it("renders correct links to source URLs", () => {
    render(<ArticleList articles={mockArticles} />);

    const link1 = screen.getByRole("link", { name: "テスト記事 1" });
    expect(link1).toHaveAttribute("href", "https://example.com/1");
    expect(link1).toHaveAttribute("target", "_blank");
    expect(link1).toHaveAttribute("rel", "noopener noreferrer");

    const link2 = screen.getByRole("link", { name: "テスト記事 2" });
    expect(link2).toHaveAttribute("href", "https://example.com/2");
  });

  it("shows score breakdown in the Nordic dimensions", async () => {
    render(<ArticleList articles={mockArticles} />);
    const scoreButton = screen.getByRole("button", { name: /スコア 8.0、内訳を表示/ });
    expect(scoreButton).toBeInTheDocument();

    fireEvent.click(scoreButton);
    expect(await screen.findByText("北欧デザインとの関連性")).toBeInTheDocument();
    expect(screen.getByText("記事の新しさ")).toBeInTheDocument();
    expect(screen.getByText("× 80%")).toBeInTheDocument();
    expect(screen.getByText("× 20%")).toBeInTheDocument();
  });

  it("renders with loading state", () => {
    const { container } = render(<ArticleList articles={mockArticles} isLoading={true} />);
    const list = container.querySelector("ul");
    expect(list).toHaveClass("opacity-60");
    expect(list).toHaveAttribute("aria-busy", "true");
  });

  it("renders an empty list", () => {
    const { container } = render(<ArticleList articles={[]} />);
    const list = container.querySelector("ul");
    expect(list).toBeInTheDocument();
    expect(list?.children).toHaveLength(0);
  });
});
