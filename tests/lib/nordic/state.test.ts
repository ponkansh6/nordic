import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  client: {
    execute: vi.fn(),
    transaction: vi.fn(),
  },
}));
vi.mock("@/lib/db", () => ({ client: mocks.client }));

import {
  acquireIngestLease,
  claimManualCooldown,
  getManualCooldownUntil,
  releaseIngestLease,
  syncProductionDeployment,
} from "@/lib/nordic/state";

describe("Nordic job state", () => {
  beforeEach(() => {
    vi.setSystemTime(new Date("2026-09-26T00:00:00.000Z"));
    mocks.client.execute.mockReset();
    mocks.client.transaction.mockReset();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
  });

  it("returns only a valid future manual cooldown", async () => {
    mocks.client.execute
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ value: "not a timestamp" }] })
      .mockResolvedValueOnce({ rows: [{ value: String(Date.now() - 1) }] })
      .mockResolvedValueOnce({ rows: [{ value: String(Date.now() + 10_000) }] });
    await expect(getManualCooldownUntil()).resolves.toBeNull();
    await expect(getManualCooldownUntil()).resolves.toBeNull();
    await expect(getManualCooldownUntil()).resolves.toBeNull();
    await expect(getManualCooldownUntil()).resolves.toBe(
      new Date(Date.now() + 10_000).toISOString(),
    );
  });

  it("synchronizes a production deployment and clears cooldown only when it changes", async () => {
    const transaction = {
      execute: vi
        .fn()
        .mockResolvedValueOnce({ rows: [{ value: "deploy-2" }] })
        .mockResolvedValueOnce({ rows: [] }),
      commit: vi.fn().mockResolvedValue(undefined),
      rollback: vi.fn().mockResolvedValue(undefined),
    };
    mocks.client.transaction.mockResolvedValue(transaction);

    await syncProductionDeployment();
    expect(mocks.client.transaction).not.toHaveBeenCalled();

    vi.stubEnv("VERCEL_ENV", "production");
    await syncProductionDeployment();
    expect(mocks.client.transaction).not.toHaveBeenCalled();

    vi.stubEnv("VERCEL_DEPLOYMENT_ID", "deploy-2");
    await syncProductionDeployment();
    expect(transaction.execute).toHaveBeenCalledTimes(2);
    expect(transaction.commit).toHaveBeenCalledOnce();

    transaction.execute.mockReset().mockResolvedValueOnce({ rows: [] });
    await syncProductionDeployment();
    expect(transaction.execute).toHaveBeenCalledTimes(1);
    expect(transaction.commit).toHaveBeenCalledTimes(2);
  });

  it("rolls back a failed deployment transaction", async () => {
    vi.stubEnv("VERCEL_ENV", "production");
    vi.stubEnv("VERCEL_GIT_COMMIT_SHA", "deploy-3");
    const transaction = {
      execute: vi.fn().mockRejectedValue(new Error("write failed")),
      commit: vi.fn(),
      rollback: vi.fn().mockResolvedValue(undefined),
    };
    mocks.client.transaction.mockResolvedValue(transaction);
    await expect(syncProductionDeployment()).rejects.toThrow("write failed");
    expect(transaction.rollback).toHaveBeenCalledOnce();
  });

  it("acquires and releases a lease using a compare-and-set write", async () => {
    mocks.client.execute
      .mockResolvedValueOnce({ rows: [{ value: "lease" }] })
      .mockResolvedValueOnce({ rows: [] });
    await expect(acquireIngestLease(Date.now())).resolves.toBe(String(Date.now() + 180_000));
    await releaseIngestLease("lease");
    expect(mocks.client.execute).toHaveBeenCalledTimes(2);

    mocks.client.execute.mockResolvedValueOnce({ rows: [] });
    await expect(acquireIngestLease(Date.now())).resolves.toBeNull();
  });

  it("claims a manual cooldown and reports the existing deadline when already claimed", async () => {
    mocks.client.execute
      .mockResolvedValueOnce({ rows: [{ value: String(Date.now() + 43_200_000) }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ value: String(Date.now() + 43_200_000) }] });
    const claimed = await claimManualCooldown(Date.now());
    expect(claimed.claimed).toBe(true);
    expect(claimed.cooldownUntil).toBe(new Date(Date.now() + 43_200_000).toISOString());

    const denied = await claimManualCooldown(Date.now());
    expect(denied).toEqual({
      claimed: false,
      cooldownUntil: new Date(Date.now() + 43_200_000).toISOString(),
    });

    mocks.client.execute
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ value: "invalid" }] });
    const malformed = await claimManualCooldown(Date.now());
    expect(malformed.claimed).toBe(false);
    expect(malformed.cooldownUntil).toBe(new Date(Date.now() + 43_200_000).toISOString());
  });
});
