import { sqliteTable, text, integer, real, index, uniqueIndex } from "drizzle-orm/sqlite-core";
export { nordicArticles, nordicJobState, nordicSources } from "./nordic-schema";

/** Preserved legacy table. Nordic reads and writes only the Nordic-specific tables below. */
export const articles = sqliteTable(
  "articles",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    title: text("title").notNull(),
    description: text("description"),
    url: text("url").notNull().unique(),
    urlToImage: text("url_to_image"),
    publishedAt: text("published_at").notNull(),
    sourceName: text("source_name"),
    sourceId: text("source_id"),
    author: text("author"),
    keyword: text("keyword"),
    summary: text("summary"),
    relevance: real("relevance"),
    usefulness: real("usefulness"),
    recency: real("recency"),
    recencyRefreshedAt: text("recency_refreshed_at"),
    reason: text("reason"),
    scoredAt: text("scored_at"),
    score: real("score"),
    contentHash: text("content_hash"), // 記事の title + description のハッシュ
    scoringSignature: text("scoring_signature"), // プロンプト版 + モデル + 嗜好セクションのハッシュ
    createdAt: text("created_at")
      .notNull()
      .$defaultFn(() => new Date().toISOString()),
  },
  (table) => ({
    keywordIdx: index("idx_keyword").on(table.keyword),
    sourceScorePubIdx: index("idx_source_score_pub").on(
      table.sourceId,
      table.score,
      table.publishedAt,
    ),
    createdAtIdx: index("idx_created_at").on(table.createdAt),
  }),
);

/** Preserved legacy table. Retained to avoid dropping existing data. */
export const favorites = sqliteTable(
  "favorites",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    articleId: integer("article_id")
      .notNull()
      .references(() => articles.id, { onDelete: "cascade" }),
    createdAt: text("created_at")
      .notNull()
      .$defaultFn(() => new Date().toISOString()),
  },
  (table) => ({
    uniqueArticle: uniqueIndex("favorites_article_id_unique").on(table.articleId),
  }),
);

/** Preserved legacy table. Retained to avoid dropping existing data. */
export const notForMe = sqliteTable(
  "not_for_me",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    articleId: integer("article_id")
      .notNull()
      .references(() => articles.id, { onDelete: "cascade" }),
    createdAt: text("created_at")
      .notNull()
      .$defaultFn(() => new Date().toISOString()),
  },
  (table) => ({
    uniqueArticle: uniqueIndex("not_for_me_article_id_unique").on(table.articleId),
  }),
);

/** Preserved legacy table. Retained to avoid dropping existing data. */
export const preferenceProfiles = sqliteTable("preference_profiles", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  version: integer("version").notNull().default(1),
  analysis: text("analysis").notNull(),
  promptSection: text("prompt_section").notNull(),
  favoriteCount: integer("favorite_count").notNull(),
  favoriteMaxId: integer("favorite_max_id").notNull().default(0),
  notForMeCount: integer("not_for_me_count").notNull().default(0),
  notForMeMaxId: integer("not_for_me_max_id").notNull().default(0),
  model: text("model").notNull(),
  createdAt: text("created_at")
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
});
