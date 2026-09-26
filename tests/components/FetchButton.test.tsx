// @vitest-environment happy-dom
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import FetchButton from "@/app/fetch-button";
import "@testing-library/jest-dom/vitest";

const mocks = vi.hoisted(() => ({
  refresh: vi.fn(),
  success: vi.fn(),
  info: vi.fn(),
  warning: vi.fn(),
  error: vi.fn(),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mocks.refresh }) }));
vi.mock("sonner", () => ({ toast: mocks }));

async function settleEffects() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

async function clickAndSettle(button: HTMLElement) {
  await act(async () => {
    fireEvent.click(button);
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

describe("FetchButton", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
    Object.values(mocks).forEach((mock) => mock.mockReset());
  });
  afterEach(() => vi.unstubAllGlobals());

  it("shows and enforces the manual cooldown", async () => {
    const cooldownUntil = new Date(Date.now() + 12 * 60 * 60 * 1_000).toISOString();
    render(<FetchButton cooldownUntil={cooldownUntil} />);
    expect(screen.getByRole("button", { name: "更新待ち" })).toBeDisabled();
    await settleEffects();
    expect(screen.getByText(/次の手動更新まで約\d+時間\d+分/)).toBeInTheDocument();
  });

  it("posts a manual ingest and reports its result", async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ result: { saved: 3, newCandidates: 5, errors: [] } }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    render(<FetchButton cooldownUntil={null} />);
    await settleEffects();
    await clickAndSettle(screen.getByRole("button", { name: "最新記事を取得" }));
    await waitFor(() =>
      expect(mocks.success).toHaveBeenCalledWith("3件を新たに保存しました（新着候補 5件）"),
    );
    expect(fetch).toHaveBeenCalledWith("/api/ingest", { method: "POST" });
    expect(mocks.refresh).toHaveBeenCalledOnce();
  });

  it("handles cooldown and busy responses", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ cooldownUntil: new Date(Date.now() + 60_000).toISOString() }),
          { status: 429 },
        ),
      )
      .mockResolvedValueOnce(new Response("{}", { status: 409 }));
    const { unmount } = render(<FetchButton cooldownUntil={null} />);
    await settleEffects();
    await clickAndSettle(screen.getByRole("button", { name: "最新記事を取得" }));
    expect(mocks.info).toHaveBeenCalledWith("手動更新は12時間ごとに実行できます");
    expect(screen.getByRole("button", { name: "更新待ち" })).toBeDisabled();

    unmount();
    render(<FetchButton cooldownUntil={null} />);
    await settleEffects();
    await clickAndSettle(screen.getByRole("button", { name: "最新記事を取得" }));
    expect(mocks.info).toHaveBeenCalledWith("定期更新を実行中です。完了後に記事一覧を更新します");
  });

  it("reports API and network errors and displays partial source warnings", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            result: { saved: 0, newCandidates: 1, errors: ["Lumene unavailable"] },
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: "fetch failed" }), { status: 500 }),
      )
      .mockRejectedValueOnce(new Error("offline"));
    render(<FetchButton cooldownUntil={null} />);
    await settleEffects();

    await clickAndSettle(screen.getByRole("button", { name: "最新記事を取得" }));
    expect(mocks.warning).toHaveBeenCalledWith("Lumene unavailable");
    await clickAndSettle(screen.getByRole("button", { name: "最新記事を取得" }));
    expect(mocks.error).toHaveBeenCalledWith("fetch failed");
    await clickAndSettle(screen.getByRole("button", { name: "最新記事を取得" }));
    expect(mocks.error).toHaveBeenCalledWith("offline");
  });
});
