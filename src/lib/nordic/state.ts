import { client } from "../db";

const MANUAL_COOLDOWN_MS = 12 * 60 * 60 * 1_000;
const INGEST_LEASE_MS = 3 * 60 * 1_000;

async function readState(key: string): Promise<string | null> {
  const result = await client.execute({
    sql: "SELECT value FROM nordic_job_state WHERE key = ? LIMIT 1",
    args: [key],
  });
  const value = result.rows[0]?.value;
  return value === null || value === undefined ? null : String(value);
}

export async function getManualCooldownUntil(now = Date.now()): Promise<string | null> {
  const value = await readState("manual_cooldown_until");
  if (!value) return null;
  const deadline = Number(value);
  return Number.isFinite(deadline) && deadline > now ? new Date(deadline).toISOString() : null;
}

export async function syncProductionDeployment(): Promise<void> {
  if (process.env.VERCEL_ENV !== "production") return;
  const deploymentId = process.env.VERCEL_DEPLOYMENT_ID ?? process.env.VERCEL_GIT_COMMIT_SHA;
  if (!deploymentId) return;

  const transaction = await client.transaction("write");
  try {
    const changed = await transaction.execute({
      sql: `INSERT INTO nordic_job_state (key, value, updated_at)
            VALUES ('production_deployment', ?, ?)
            ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
            WHERE nordic_job_state.value <> excluded.value
            RETURNING value`,
      args: [deploymentId, new Date().toISOString()],
    });
    if (changed.rows.length > 0) {
      await transaction.execute({
        sql: "DELETE FROM nordic_job_state WHERE key = 'manual_cooldown_until'",
      });
    }
    await transaction.commit();
  } catch (error) {
    await transaction.rollback();
    throw error;
  }
}

export async function acquireIngestLease(now = Date.now()): Promise<string | null> {
  const deadline = now + INGEST_LEASE_MS;
  const leaseToken = String(deadline);
  const result = await client.execute({
    sql: `INSERT INTO nordic_job_state (key, value, updated_at)
          VALUES ('ingest_lease_until', ?, ?)
          ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
          WHERE CAST(nordic_job_state.value AS INTEGER) <= ?
          RETURNING value`,
    args: [leaseToken, new Date(now).toISOString(), now],
  });
  return result.rows.length > 0 ? leaseToken : null;
}

export async function releaseIngestLease(leaseToken: string): Promise<void> {
  await client.execute({
    sql: "DELETE FROM nordic_job_state WHERE key = 'ingest_lease_until' AND value = ?",
    args: [leaseToken],
  });
}

export async function claimManualCooldown(
  now = Date.now(),
): Promise<{ claimed: boolean; cooldownUntil: string }> {
  const deadline = now + MANUAL_COOLDOWN_MS;
  const result = await client.execute({
    sql: `INSERT INTO nordic_job_state (key, value, updated_at)
          VALUES ('manual_cooldown_until', ?, ?)
          ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
          WHERE CAST(nordic_job_state.value AS INTEGER) <= ?
          RETURNING value`,
    args: [String(deadline), new Date(now).toISOString(), now],
  });
  const value = result.rows[0]?.value;
  if (result.rows.length > 0 && value !== undefined) {
    return { claimed: true, cooldownUntil: new Date(Number(value)).toISOString() };
  }
  const current = await readState("manual_cooldown_until");
  const currentDeadline = Number(current);
  return {
    claimed: false,
    cooldownUntil: Number.isFinite(currentDeadline)
      ? new Date(currentDeadline).toISOString()
      : new Date(deadline).toISOString(),
  };
}
