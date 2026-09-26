// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { SkeletonCard, SkeletonList } from "@/components/article/article-skeleton";
import "@testing-library/jest-dom/vitest";

describe("article skeletons", () => {
  it("renders one skeleton article", () => {
    const { container } = render(<SkeletonCard />);
    expect(container.querySelector("article")).toBeInTheDocument();
  });

  it("renders the requested number of loading rows", () => {
    render(<SkeletonList count={3} />);
    expect(screen.getByRole("list", { name: "記事を読み込み中" })).toHaveAttribute(
      "aria-busy",
      "true",
    );
    expect(screen.getAllByRole("status")).toHaveLength(3);
  });
});
