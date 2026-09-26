"use client";

import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { scoreTier, SCORE_TIER_LABEL } from "@/lib/ui/score";
import { cn } from "@/lib/utils";

interface ScorePopoverProps {
  score: number | null;
  nordicRelevance: number | null;
  recency: number | null;
}

function ScoreBreakdown({ score, nordicRelevance, recency }: ScorePopoverProps) {
  const tier = scoreTier(score);
  const line = (label: string, value: number | null, weight: string) => (
    <div className="grid grid-cols-[1fr_auto_auto] items-center gap-3 text-xs">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-mono tabular-nums">{value === null ? "--" : value.toFixed(1)}</span>
      <span className="text-right text-muted-foreground">× {weight}</span>
    </div>
  );

  return (
    <div
      className="space-y-2"
      aria-label={
        score === null ? "未採点" : `スコア ${score.toFixed(1)}、${SCORE_TIER_LABEL[tier]}`
      }
    >
      {line("北欧デザインとの関連性", nordicRelevance, "80%")}
      {line("記事の新しさ", recency, "20%")}
      <div className="flex items-center justify-between border-t pt-2 text-sm font-medium">
        <span>合計</span>
        <span className="font-mono">{score === null ? "--" : score.toFixed(1)}</span>
      </div>
    </div>
  );
}

export function ScorePopover({ score, nordicRelevance, recency }: ScorePopoverProps) {
  if (score === null)
    return <span className="shrink-0 px-1 text-xs text-muted-foreground">--</span>;
  const tier = scoreTier(score);
  const textColor =
    tier === "high" ? "text-score-high" : tier === "mid" ? "text-score-mid" : "text-score-low";

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={`スコア ${score.toFixed(1)}、内訳を表示`}
          className={cn(
            "shrink-0 rounded px-1 font-mono text-xs font-semibold tabular-nums hover:bg-accent hover:text-accent-foreground focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring",
            textColor,
          )}
        >
          {score.toFixed(1)}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-72">
        <ScoreBreakdown score={score} nordicRelevance={nordicRelevance} recency={recency} />
      </PopoverContent>
    </Popover>
  );
}

export default ScorePopover;
