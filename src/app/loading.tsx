import { PageShell } from "@/components/layout/page-shell";
import { Skeleton } from "@/components/ui/skeleton";
import { SkeletonList } from "@/components/article/article-skeleton";

export default function Loading() {
  return (
    <PageShell title="Nordic">
      <div className="space-y-6">
        <Skeleton className="h-10 w-32 rounded-md" />
        <SkeletonList />
      </div>
    </PageShell>
  );
}
