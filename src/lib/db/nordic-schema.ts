import { integer, index, real, sqliteTable, text } from "drizzle-orm/sqlite-core";

/** Nordic-specific source registry. Existing source and article tables stay intact. */
export const nordicSources = sqliteTable("nordic_sources", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  siteUrl: text("site_url").notNull(),
  feedUrl: text("feed_url"),
  createdAt: text("created_at")
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
});

/** Articles collected for Nordic; each row belongs to one Nordic source. */
export const nordicArticles = sqliteTable(
  "nordic_articles",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    sourceId: text("source_id")
      .notNull()
      .references(() => nordicSources.id, { onDelete: "restrict" }),
    url: text("url").notNull().unique(),
    title: text("title").notNull(),
    description: text("description"),
    urlToImage: text("url_to_image"),
    publishedAt: text("published_at").notNull(),
    summary: text("summary"),
    nordicRelevance: real("nordic_relevance"),
    recency: real("recency"),
    score: real("score"),
    reason: text("reason"),
    scoredAt: text("scored_at"),
    createdAt: text("created_at")
      .notNull()
      .$defaultFn(() => new Date().toISOString()),
  },
  (table) => ({
    sourceScorePublishedIdx: index("nordic_articles_source_score_published_idx").on(
      table.sourceId,
      table.score,
      table.publishedAt,
    ),
    publishedIdx: index("nordic_articles_published_idx").on(table.publishedAt),
  }),
);

/** Shared coordination store for the global manual cooldown and ingest lease. */
export const nordicJobState = sqliteTable("nordic_job_state", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: text("updated_at")
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
});
