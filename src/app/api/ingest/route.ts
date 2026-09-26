import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { triggerNordicIngestion } from "@/lib/nordic/ingest";

export const maxDuration = 60;

function sameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return true;
  try {
    return new URL(origin).host === request.headers.get("host");
  } catch {
    return false;
  }
}

function authorizedCron(request: Request): boolean {
  const expected = process.env.CRON_SECRET;
  if (!expected) return false;
  const authorization = request.headers.get("authorization");
  if (!authorization?.startsWith("Bearer ")) return false;
  const actualBuffer = Buffer.from(authorization.slice(7));
  const expectedBuffer = Buffer.from(expected);
  return (
    actualBuffer.length === expectedBuffer.length && timingSafeEqual(actualBuffer, expectedBuffer)
  );
}

export async function POST(request: Request) {
  if (!sameOrigin(request))
    return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  try {
    const result = await triggerNordicIngestion("manual");
    if (result.status === "cooldown") {
      return NextResponse.json({ ok: false, ...result }, { status: 429 });
    }
    if (result.status === "busy") {
      return NextResponse.json({ ok: false, ...result }, { status: 409 });
    }
    if (result.status === "failed") {
      console.error("[api/ingest] Manual Nordic ingest failed:", result.error);
      return NextResponse.json(
        {
          ok: false,
          status: result.status,
          error: "記事を取得できませんでした",
          cooldownUntil: result.cooldownUntil,
        },
        { status: 500 },
      );
    }
    return NextResponse.json({ ok: true, cooldownUntil: result.result.cooldownUntil, ...result });
  } catch (error) {
    console.error("[api/ingest] Manual Nordic ingest failed:", error);
    return NextResponse.json({ ok: false, error: "記事を取得できませんでした" }, { status: 500 });
  }
}

export async function GET(request: Request) {
  if (!authorizedCron(request)) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  try {
    const result = await triggerNordicIngestion("cron");
    if (result.status === "busy")
      return NextResponse.json({ ok: true, ...result }, { status: 202 });
    if (result.status === "failed")
      return NextResponse.json({ ok: false, ...result }, { status: 500 });
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    console.error("[api/ingest] Scheduled Nordic ingest failed:", error);
    return NextResponse.json({ ok: false, error: "記事を取得できませんでした" }, { status: 500 });
  }
}
