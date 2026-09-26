import { beforeEach, describe, expect, it, vi } from "vitest";

const { triggerNordicIngestion } = vi.hoisted(() => ({ triggerNordicIngestion: vi.fn() }));
vi.mock("@/lib/nordic/ingest", () => ({ triggerNordicIngestion }));

import { GET, POST } from "@/app/api/ingest/route";

function request(method: "GET" | "POST", headers: Record<string, string> = {}) {
  return new Request("https://nordic.example/api/ingest", { method, headers });
}

describe("/api/ingest", () => {
  beforeEach(() => {
    triggerNordicIngestion.mockReset();
    vi.stubEnv("CRON_SECRET", "cron-secret");
  });

  it("rejects a cross-origin manual request and malformed origins", async () => {
    const crossOrigin = await POST(
      request("POST", { origin: "https://attacker.example", host: "nordic.example" }),
    );
    expect(crossOrigin.status).toBe(403);
    const malformed = await POST(request("POST", { origin: "not a URL", host: "nordic.example" }));
    expect(malformed.status).toBe(403);
    expect(triggerNordicIngestion).not.toHaveBeenCalled();
  });

  it("returns cooldown and busy responses for manual updates", async () => {
    triggerNordicIngestion
      .mockResolvedValueOnce({ status: "cooldown", cooldownUntil: "2026-09-27T00:00:00Z" })
      .mockResolvedValueOnce({ status: "busy", cooldownUntil: null });
    const cooldown = await POST(request("POST"));
    expect(cooldown.status).toBe(429);
    await expect(cooldown.json()).resolves.toMatchObject({ ok: false, status: "cooldown" });
    const busy = await POST(
      request("POST", { origin: "https://nordic.example", host: "nordic.example" }),
    );
    expect(busy.status).toBe(409);
    await expect(busy.json()).resolves.toMatchObject({ ok: false, status: "busy" });
  });

  it("returns completed results, sanitized failures, and catches thrown errors", async () => {
    triggerNordicIngestion
      .mockResolvedValueOnce({ status: "completed", result: { saved: 2 }, cooldownUntil: null })
      .mockResolvedValueOnce({
        status: "failed",
        error: "database credentials",
        cooldownUntil: null,
      })
      .mockRejectedValueOnce(new Error("internal detail"));
    const completed = await POST(request("POST"));
    expect(completed.status).toBe(200);
    await expect(completed.json()).resolves.toMatchObject({
      ok: true,
      status: "completed",
      result: { saved: 2 },
    });
    const failed = await POST(request("POST"));
    expect(failed.status).toBe(500);
    await expect(failed.json()).resolves.toMatchObject({
      ok: false,
      error: "記事を取得できませんでした",
    });
    const thrown = await POST(request("POST"));
    expect(thrown.status).toBe(500);
    await expect(thrown.json()).resolves.toMatchObject({
      ok: false,
      error: "記事を取得できませんでした",
    });
  });

  it("requires a matching bearer secret for scheduled runs", async () => {
    vi.stubEnv("CRON_SECRET", "");
    expect((await GET(request("GET"))).status).toBe(401);
    vi.stubEnv("CRON_SECRET", "cron-secret");
    expect((await GET(request("GET", { authorization: "Basic abc" }))).status).toBe(401);
    expect((await GET(request("GET", { authorization: "Bearer wrong" }))).status).toBe(401);
    expect(triggerNordicIngestion).not.toHaveBeenCalled();
  });

  it("returns appropriate scheduled-run outcomes", async () => {
    triggerNordicIngestion
      .mockResolvedValueOnce({ status: "busy", cooldownUntil: null })
      .mockResolvedValueOnce({ status: "failed", error: "ingest failed", cooldownUntil: null })
      .mockResolvedValueOnce({ status: "completed", result: { saved: 1 } })
      .mockRejectedValueOnce(new Error("internal error"));
    const headers = { authorization: "Bearer cron-secret" };
    expect((await GET(request("GET", headers))).status).toBe(202);
    expect((await GET(request("GET", headers))).status).toBe(500);
    expect((await GET(request("GET", headers))).status).toBe(200);
    expect((await GET(request("GET", headers))).status).toBe(500);
    expect(triggerNordicIngestion).toHaveBeenCalledWith("cron");
  });
});
