import { Newspaper } from "lucide-react";
import { ArticleList, type Article } from "@/components/article/article-list";
import { Card } from "@/components/ui/card";

export function NewsSection({ articles }: { articles: Article[] }) {
  return (
    <div className="space-y-3">
      <div className="mb-2 flex items-center justify-between sm:mb-4">
        <h1 className="text-xl font-semibold">
          北欧デザインの記事
          <span className="ml-2 text-sm font-normal text-muted-foreground">
            ({articles.length}件)
          </span>
        </h1>
      </div>
      {articles.length === 0 ? (
        <Card className="p-12 text-center">
          <Newspaper className="mx-auto mb-4 h-12 w-12 text-muted-foreground" />
          <h2 className="text-lg font-semibold">まだ記事がありません</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            最新記事を取得して、日本語の要約とスコアを作成できます。
          </p>
        </Card>
      ) : (
        <ArticleList articles={articles} />
      )}
    </div>
  );
}

export default NewsSection;
