"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, RefreshCw } from "lucide-react";
import { toast } from "sonner";

interface FetchButtonProps {
  cooldownUntil: string | null;
}

interface FetchButtonStateProps {
  initialCooldownUntil: string | null;
}

function formatRemaining(milliseconds: number): string {
  const hours = Math.floor(milliseconds / 3_600_000);
  const minutes = Math.floor((milliseconds % 3_600_000) / 60_000);
  return `${hours}時間${minutes}分`;
}

export default function FetchButton({ cooldownUntil: initialCooldownUntil }: FetchButtonProps) {
  return (
    <FetchButtonState
      key={initialCooldownUntil ?? "no-cooldown"}
      initialCooldownUntil={initialCooldownUntil}
    />
  );
}

function FetchButtonState({ initialCooldownUntil }: FetchButtonStateProps) {
  const router = useRouter();
  const [isRefreshing, setRefreshing] = useState(false);
  const [cooldownUntil, setCooldownUntil] = useState(initialCooldownUntil);
  const [now, setNow] = useState<number | null>(null);
  const remaining = cooldownUntil && now !== null ? new Date(cooldownUntil).getTime() - now : 0;
  const coolingDown = Boolean(cooldownUntil) && (now === null || remaining > 0);
  const cooldownLabel = formatRemaining(Math.max(0, remaining));

  useEffect(() => {
    const initialTick = window.setTimeout(() => setNow(Date.now()), 0);
    const interval = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => {
      window.clearTimeout(initialTick);
      window.clearInterval(interval);
    };
  }, []);

  const fetchNews = async () => {
    if (isRefreshing || coolingDown) return;
    setRefreshing(true);
    try {
      const response = await fetch("/api/ingest", { method: "POST" });
      const result = (await response.json()) as {
        status?: string;
        cooldownUntil?: string | null;
        result?: { saved: number; newCandidates: number; errors: string[] };
        error?: string;
      };
      if (result.cooldownUntil) setCooldownUntil(result.cooldownUntil);
      if (response.status === 429) {
        toast.info("手動更新は12時間ごとに実行できます");
      } else if (response.status === 409) {
        toast.info("定期更新を実行中です。完了後に記事一覧を更新します");
      } else if (!response.ok) {
        throw new Error(result.error ?? "記事を取得できませんでした");
      } else if (result.result) {
        const { saved, newCandidates, errors } = result.result;
        toast.success(`${saved}件を新たに保存しました（新着候補 ${newCandidates}件）`);
        if (errors.length > 0) toast.warning(errors.join(" / "));
      }
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "記事を取得できませんでした");
    } finally {
      setRefreshing(false);
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-3">
      <button
        type="button"
        onClick={fetchNews}
        disabled={isRefreshing || coolingDown}
        className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {isRefreshing ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <RefreshCw className="h-4 w-4" />
        )}
        {isRefreshing ? "取得・採点中..." : coolingDown ? "更新待ち" : "最新記事を取得"}
      </button>
      {coolingDown && (
        <p className="text-sm text-muted-foreground" aria-live="polite">
          次の手動更新まで約{cooldownLabel}（定期更新は毎日実行）
        </p>
      )}
    </div>
  );
}
