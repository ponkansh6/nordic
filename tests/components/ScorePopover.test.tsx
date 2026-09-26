// @vitest-environment happy-dom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ScorePopover } from "@/components/article/score-popover";

describe("ScorePopover", () => {
  it("renders the Nordic relevance and recency weights", async () => {
    render(<ScorePopover score={8.3} nordicRelevance={8} recency={9.5} />);
    screen.getByRole("button", { name: "スコア 8.3、内訳を表示" }).click();

    expect(await screen.findByText("北欧デザインとの関連性")).toBeDefined();
    expect(screen.getByText("記事の新しさ")).toBeDefined();
    expect(screen.getByText("× 80%")).toBeDefined();
    expect(screen.getByText("× 20%")).toBeDefined();
  });
});
