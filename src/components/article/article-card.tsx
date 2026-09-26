"use client";

import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ScorePopover } from "./score-popover";
import { scoreTier } from "@/lib/ui/score";
import { HelpCircle } from "lucide-react";
import { cn } from "@/lib/utils";

export interface ArticleCardProps {
  id: number;
  title: string;
  url: string;
  sourceName: string;
  sourceId: string;
  publishedAt: string;
  summary: string | null;
  nordicRelevance: number | null;
  recency: number | null;
  score: number | null;
  reason: string | null;
}

function formatDate(iso: string): string {
  const value = new Date(iso);
  return Number.isNaN(value.getTime()) || value.getUTCFullYear() < 2000
    ? "日付不明"
    : value.toLocaleDateString("ja-JP", { year: "numeric", month: "2-digit", day: "2-digit" });
}

export function ArticleCard({
  title,
  url,
  sourceName,
  publishedAt,
  summary,
  nordicRelevance,
  recency,
  score,
  reason,
}: ArticleCardProps) {
  const tier = scoreTier(score);
  const barColor =
    tier === "high" ? "bg-score-high" : tier === "mid" ? "bg-score-mid" : "bg-score-low";

  return (
    <li className="relative bg-card transition-colors sm:overflow-hidden sm:rounded-xl sm:ring-1 sm:ring-foreground/10 sm:hover:shadow-sm">
      <span
        aria-hidden
        className={cn("absolute inset-y-4 left-0 w-1 rounded-r-full sm:inset-y-3", barColor)}
      />
      <article className="px-3 py-4 sm:px-4 sm:py-3.5">
        <h2 className="text-base font-semibold leading-snug text-foreground">
          <a href={url} target="_blank" rel="noopener noreferrer" className="hover:text-primary">
            {title}
          </a>
        </h2>
        {summary && (
          <p className="mt-2 line-clamp-3 text-sm leading-relaxed text-muted-foreground">
            {summary}
          </p>
        )}
        <div className="mt-3 flex min-w-0 items-center gap-2 text-xs">
          <ScorePopover score={score} nordicRelevance={nordicRelevance} recency={recency} />
          <span aria-hidden className="text-muted-foreground">
            ·
          </span>
          <span className="shrink-0 font-medium text-muted-foreground">{sourceName}</span>
          <span aria-hidden className="text-muted-foreground">
            ·
          </span>
          <time dateTime={publishedAt} className="shrink-0 text-muted-foreground">
            {formatDate(publishedAt)}
          </time>
          {reason && (
            <>
              <span aria-hidden className="text-muted-foreground">
                ·
              </span>
              <Popover>
                <PopoverTrigger asChild>
                  <button
                    type="button"
                    className="inline-flex min-w-0 flex-1 items-center gap-1 text-muted-foreground hover:text-foreground"
                    aria-label={`評価理由: ${reason}`}
                  >
                    <HelpCircle className="h-3 w-3 shrink-0" />
                    <span className="truncate">{reason}</span>
                  </button>
                </PopoverTrigger>
                <PopoverContent className="w-72 text-sm leading-relaxed">{reason}</PopoverContent>
              </Popover>
            </>
          )}
        </div>
      </article>
    </li>
  );
}

export default ArticleCard;
