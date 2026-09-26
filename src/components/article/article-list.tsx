import type { NordicArticleRow } from "@/lib/db/nordic";
import { ArticleCard } from "./article-card";

export type Article = NordicArticleRow;

interface ArticleListProps {
  articles: Article[];
  isLoading?: boolean;
}

export function ArticleList({ articles, isLoading }: ArticleListProps) {
  return (
    <ul
      role="list"
      className={`-mx-4 divide-y-8 divide-muted sm:mx-0 sm:divide-y-0 sm:space-y-3 ${isLoading ? "opacity-60" : ""}`}
      aria-busy={isLoading}
    >
      {articles.map((article) => (
        <ArticleCard key={article.id} {...article} />
      ))}
    </ul>
  );
}

export default ArticleList;
