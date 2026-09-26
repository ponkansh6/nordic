# News Watch リファクタリング提案（Vercel 商用デプロイ前提）

- **作成日**: 2026-08-02
- **対象コミット**: `155f1d5`
- **前提**: 商用環境は Vercel（Next.js 16 App Router / Node.js runtime）+ Turso（libSQL リモート）
- **目的**: (1) レスポンスとコストの改善 (2) ソース追加コストの削減 (3) 型安全性・運用面のリスク低減

> このドキュメントは提案であり、実装は含まない。各項目を採用する際は `openspec/specs/news-watch/spec.md` の該当セクション（§5 Data Model / §6 Architecture / §4 NFR）も同時に更新すること（pre-commit `check-spec-update.sh` が警告する）。

---

## 0. 優先度サマリ

| #      | 項目                                                 | 分類         | 効果                               | 労力 | 優先   |
| ------ | ---------------------------------------------------- | ------------ | ---------------------------------- | ---- | ------ |
| **P1** | RSC ペイロードから `embedding` を除外                | 性能         | 転送量 **約 1MB → 約 30KB**        | S    | 最優先 |
| **P2** | DB 書き込みのバッチ化（upsert / recency 更新）       | 性能         | Turso 往復 **100+ 回 → 2 回**      | M    | 高     |
| **P3** | ダッシュボードクエリ用の複合インデックス追加         | 性能         | フルスキャン + ソート排除          | S    | 高     |
| **P4** | `force-dynamic` 撤廃 → タグ付きキャッシュ            | 性能         | 再訪時 DB アクセス 0               | M    | 高     |
| **P5** | コールドスタート削減（不要依存の切り離し）           | 性能         | 起動時の Gemini SDK 初期化を排除   | S    | 高     |
| **P6** | LLM バッチ呼び出しの並列化 + 後処理の `waitUntil` 化 | 性能         | パイプライン所要時間の短縮         | M    | 中     |
| **R1** | ソースレジストリ化（`route.ts` の分岐撲滅）          | 構造         | ソース追加が 1 ファイルで完結      | M    | 高     |
| **R2** | フィードアダプタの宣言的定義化                       | 構造         | 9 ファイル → 1 テーブル + 3 パーサ | M    | 中     |
| **S1** | `/admin/db` の無認証公開                             | セキュリティ | DB 全内容の露出を封じる            | S    | 最優先 |
| **C1** | softmax によるスコア相対化の副作用                   | 正確性       | スコアの意味を安定させる           | M    | 中     |

---

## 1. 現状アーキテクチャの要約

```
POST /api/fetch-news (maxDuration=60)
  ├ cleanupOrphaned()                          … DELETE
  ├ searchXxx(20)                              … 選択された 1 ソースのみ fetch
  ├ normalize() × N → deduplicate() → slice(20)
  ├ refreshRecency()                           … SELECT + UPDATE × N（逐次）
  ├ tagArticlesByKeyword()                     … 埋め込みキャッシュ参照 + batchEmbed
  ├ scoreAndSaveTagged()                       … キーワード群ごとに LLM バッチ（逐次）→ upsert × N（逐次）
  └ cleanupLowScored()                         … DELETE

GET / (force-dynamic)
  └ getScoredArticles(100, source)  → NewsSection ("use client") → ArticleList ("use client")
```

構造そのものは妥当（取得 → 正規化 → タグ付け → スコアリング → 永続化）。問題は**境界の切り方**と**I/O の粒度**に集中している。

---

## 2. パフォーマンス改善（Vercel 前提）

### P1. RSC ペイロードから `embedding` を除外 ★最優先

**現状の問題**

`getScoredArticles()` は `db.select().from(articles)`（= 全カラム）を返し、`page.tsx` がその結果をそのまま Client Component (`NewsSection`) に渡している。

```ts
// src/lib/db/query/article-queries.ts:21
return await db.select().from(articles).where(...)   // ← embedding を含む全カラム

// src/app/page.tsx:10
const scored = await getScoredArticles(100, selectedSource);
return <NewsSection articles={scored} />              // ← "use client" 境界
```

`articles.embedding` は 768 次元 float の JSON 文字列で **1 行あたり約 10KB**。limit=100 なので RSC Flight ペイロード（= HTML にインライン展開される）に **約 1MB** の使われないベクトルが載る。`ArticleList` の `Article` 型に `embedding` は無いが、TypeScript の型は実行時のシリアライズ対象を制限しないため無効。

**対策**

1. クエリ側で必要カラムのみ明示選択する（表示用と埋め込みキャッシュ用でクエリを分離）。

```ts
// article-queries.ts
const ARTICLE_LIST_COLUMNS = {
  id: articles.id,
  title: articles.title,
  url: articles.url,
  publishedAt: articles.publishedAt,
  sourceName: articles.sourceName,
  sourceId: articles.sourceId,
  keyword: articles.keyword,
  summary: articles.summary,
  relevance: articles.relevance,
  usefulness: articles.usefulness,
  recency: articles.recency,
  score: articles.score,
  reason: articles.reason,
} as const;

export async function getScoredArticles(limit, sourceIds?) {
  return db.select(ARTICLE_LIST_COLUMNS).from(articles).where(...);
}
```

2. `description` も一覧では未使用（`summary` のみ表示）なので除外対象。
3. `getFavoriteArticles()` も同様に全カラム SELECT → `embedding` を返している（`bookmarks/page.tsx` で `as any` キャストして `ArticleList` へ）。同じ列セットに揃える。
4. **再発防止**: `AssertSerializable`（`src/lib/serializable.ts`）は既にあるので、`ArticleListProps` を `AssertSerializable<{ articles: Article[] }>` で縛るだけでは不十分。列セットを `ARTICLE_LIST_COLUMNS` に一元化し、`Article` 型をその推論型から導出する（`type Article = Awaited<ReturnType<typeof getScoredArticles>>[number]`）ことで型と実データを一致させる。

**期待効果**: ページ HTML 約 1MB → 約 30KB。NFR「ダッシュボード load time < 2s」に対し、モバイル回線での改善が最も大きい単一項目。

---

### P2. DB 書き込みのバッチ化 ★高

Vercel の関数から Turso への往復は 1 回あたり数十 ms。現状は行単位で往復している。

**(a) `refreshRecencyForSources` — N 回の UPDATE を逐次実行**

```ts
// article-repository.ts:107-126
for (const article of targetArticles) {
  await db.update(articles).set({...}).where(eq(articles.url, article.url));  // ← 1 行ずつ往復
}
```

対象は「選択ソースの既存記事のうち今回取得しなかったもの」で、数百件になり得る。

対策 A（推奨・シンプル）: recency の再計算は決定的な関数なので、**SQL 側で一括更新**できる。tier 境界を `CASE WHEN julianday('now') - julianday(published_at) <= 1 THEN 10 ...` で表現し 1 クエリに畳む。

対策 B（保守的）: 計算は TS のまま、`db.batch()` で 1 往復にまとめる。libSQL ドライバは `db.batch([...])` をサポートする。

```ts
const stmts = targetArticles.map((a) =>
  db.update(articles).set({ recency, score, recencyRefreshedAt }).where(eq(articles.url, a.url)),
);
await db.batch(stmts); // 1 往復
```

**(b) `scoreAndSaveBatch` — upsert を 1 行ずつ**

```ts
// score-pipeline.ts:81
for (let i = 0; i < batch.length; i++) {
  await upsertArticle({ ... });   // ← バッチ内 20 件を逐次往復
}
```

Drizzle の `.values([...])` は複数行の `onConflictDoUpdate` に対応するため、`excluded.` 参照で 1 クエリ化できる。

```ts
await db
  .insert(articles)
  .values(rows)
  .onConflictDoUpdate({
    target: articles.url,
    set: {
      title: sql`excluded.title`,
      score: sql`excluded.score`,
      /* ... */
    },
  });
```

ただし現状の「1 件失敗しても他は保存する」挙動が失われるため、**バッチ失敗時のみ行単位フォールバック**を残す（`batchEmbed` が既に採っているパターンと同型）。

**期待効果**: 1 回の fetch あたりの DB 往復が 100 回超 → 2〜3 回。Turso の行課金（read/write rows）にも効く。

---

### P3. ダッシュボードクエリ用インデックス ★高

主クエリはこれ:

```sql
SELECT ... FROM articles
WHERE score IS NOT NULL AND source_id = ?
ORDER BY score DESC, published_at DESC
LIMIT 100;
```

現存インデックスは `idx_keyword` / `idx_relevance_pub` / `idx_recency_pub` / `idx_created_at` の 4 つで、**このクエリを 1 つも支えていない**。フルスキャン + 一時 B-tree ソートになる。

```sql
CREATE INDEX idx_source_score_pub ON articles (source_id, score DESC, published_at DESC);
```

併せて、実際に使われていない `idx_relevance_pub` / `idx_recency_pub` は削除候補（書き込み時のコストのみ発生している）。`relevance` 単体・`recency` 単体で絞る・並べるクエリはコードベースに存在しない。

`refreshRecencyForSources` の `WHERE source_id IN (...) AND url NOT IN (...)` も上記の先頭カラムで効く。

**注意**: `schema.ts` を変更したら `drizzle-kit generate` → マイグレーション追加 → `tests/db/schema-consistency.test.ts`（pre-push でブロック）を通すこと。

---

### P4. `force-dynamic` の撤廃とタグ付きキャッシュ ★高

現状、`/`・`/bookmarks`・`/admin/db/*` の全ページが `export const dynamic = "force-dynamic"`。ソースは 9 種類しかなく、内容が変わるのは fetch-news が走った時だけなので、リクエストごとに Turso を叩く必要はない。

```ts
// src/lib/db/query/article-queries.ts
import { unstable_cache } from "next/cache";

export const getScoredArticlesCached = unstable_cache(
  (limit: number, source: string) => getScoredArticles(limit, source),
  ["scored-articles"],
  { tags: ["articles"], revalidate: 300 },
);
```

```ts
// src/app/api/fetch-news/route.ts の末尾
revalidateTag("articles");
```

これで「fetch ボタンを押した本人には即時反映、他の閲覧者には DB アクセス 0」が両立する。`router.refresh()` 後の RSC 再取得も Data Cache ヒットになる。

- Next.js 16 なら `"use cache"` + `cacheTag()` / `cacheLife()`（`cacheComponents` フラグ）でも同じことができる。導入前に `next@16.2.10` での安定度を確認すること。
- `/admin/db/*` は S1（認証）とセットで扱う。管理画面は `force-dynamic` のままでよい。

---

### P5. コールドスタート削減 ★高

**(a) `schema.ts` → `embeddings.ts` → Gemini SDK の依存連鎖**

```ts
// src/lib/db/schema.ts:2
import { EMBEDDING_DIMENSIONS } from "../embeddings";
```

```ts
// src/lib/embeddings.ts:12  ← モジュール読み込み時に実行される
const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY || "");
```

`schema.ts` は `db/index.ts` 経由で **全 RSC ページ**が読み込む。結果として、記事一覧を表示するだけのリクエストで `@google/generative-ai` がバンドル・評価・インスタンス化される。

対策: `EMBEDDING_DIMENSIONS` / `EMBEDDING_MODEL_VERSION` を `constants.ts`（または `lib/embeddings/constants.ts`）へ移し、`schema.ts` から SDK への経路を切る。併せて `genAI` はモジュールトップではなく遅延生成（`function getClient()`）にする。これは `client.ts` が既に `callGemini` 内で生成しており、**embeddings.ts だけが逸脱している**。

**(b) `next.config.ts` が空**

```ts
const nextConfig: NextConfig = {
  poweredByHeader: false,
  serverExternalPackages: ["@libsql/client"], // ネイティブ依存をバンドル対象外に
  experimental: {
    optimizePackageImports: ["@google/generative-ai"],
  },
};
```

**(c) `drizzle-kit` が `dependencies` にある**

```jsonc
"dependencies": {
  "drizzle-kit": "^0.31.10",   // ← マイグレーション生成専用。実行時には不要
```

`devDependencies` へ移動する。Vercel の本番インストールとビルドキャッシュが軽くなる。`drizzle.config.ts` はビルド時に読まれないので影響なし。

**(d) 未使用依存**

- `p-limit`（`dependencies`）— コードベースに参照なし。ただし **P6 で使うので残す**か、使わないなら削除。
- `.env.local.example` の `NEWS_API_KEY` / `CRON_SECRET` / `HATENA_PROXY_URL` — いずれも `src/` に参照が無い（`hatena-discovery.ts` は既に存在しない）。実態と乖離しているので削除するか、cron 実装（§5）とセットで復活させる。

---

### P6. パイプラインの並列化と後処理の追い出し ★中

**(a) LLM バッチが完全逐次**

```ts
// score-pipeline.ts:45-52
for (const [keyword, group] of taggedByKeyword) {
  // 最大 8 キーワード群
  for (let start = 0; start < group.length;) {
    savedCount += await scoreAndSaveBatch(batch, keyword); // ← 直列
  }
}
```

日本語記事が多い場合 `JAPANESE_LARGE_BATCH = 8` になるため、20 記事でも複数バッチに割れる。1 バッチのタイムアウトは `LLM_BATCH_TIMEOUT_MS = 55_000` で、`maxDuration = 60` に対してほぼ余裕がない。Hobby プランなら 1 バッチ失敗で全体が落ちる。

対策: 既に依存にある `p-limit` で、バッチ単位の並列度を 3〜4 に上げる。Gemini 側のレート制限は `callGemini` のバックオフで吸収される。

```ts
const limit = pLimit(LLM_BATCH_CONCURRENCY);
const counts = await Promise.all(
  allBatches.map((b) => limit(() => scoreAndSaveBatch(b.items, b.keyword))),
);
```

併せて `LLM_BATCH_TIMEOUT_MS` を実測に基づいて下げ（例: 25s）、リトライ余地を残す。

**(b) ユーザー応答に不要な後処理**

`cleanupOrphaned()`（先頭）と `cleanupLowScored()`（末尾）は UI が待つ必要のない DELETE。`@vercel/functions` の `waitUntil()` でレスポンス後に逃がせる。

```ts
import { waitUntil } from "@vercel/functions";
// ...
waitUntil(cleanupLowScored(since));
return NextResponse.json({ ok: true, ... });
```

**(c) `maxDuration` と実行モデル**

`maxDuration = 60` のコメントは Hobby=60 / Pro=900 を前提にしている。商用（Pro 以上）に載せるなら 300 程度まで引き上げ、上記並列化と合わせて余裕を持たせる。Fluid Compute 有効時は I/O 待ちが課金対象外に近づくため、並列化のコスト影響も小さい。

**(d) `getBatchSize` の再スライス**

```ts
const batchSize = getBatchSize(group.slice(start)); // ← ループ毎に配列コピー + 全走査
```

日本語比率は群ごとに 1 回計算すれば足りる。O(n²) を O(n) に落とす（規模的には軽微だが、無償の修正）。

---

### P7. クライアント側の二重ソートと不要な Client Component

**(a) 二重ソート**

SQL が `ORDER BY score DESC, published_at DESC` で返したものを、`NewsSection` が全く同じキーで再ソートしている。

```ts
// news-section.tsx:32
const sortedArticles = [...articles].sort((a, b) => {
  /* score → publishedAt */
});
```

配列コピー + ソートが毎レンダリング発生する。DB のソートを信頼して削除する（`getFavoriteArticles` 経由で `bookmarks` から渡される場合だけ順序が違うので、そちらはページ側で整える）。

**(b) `ArticleList` が丸ごと Client Component**

記事カードの描画自体はインタラクションを持たない。クライアント側の状態は「お気に入りの 5 連タップ」と「トースト」だけ。

- `ArticleList` を RSC 化し、タップ検出とトーストを小さな Client 島（例: `FavoriteTapZone`）に切り出す
- `useEffect` での `/api/favorites` 追加フェッチ（ウォーターフォール）を廃止し、`page.tsx` で `getFavoriteIds()` を同時取得して props で渡す

これで初期表示のリクエスト数が 1 本減り、JS バンドルも縮む。

**(c) `KEYWORD_LABELS` の解決位置**

`article-list.tsx` は `@/lib/config` の `KEYWORDS` / `KEYWORD_LABELS` を import しており、監視キーワード一式がクライアントバンドルに入る。ラベル解決をサーバ側（クエリ or ページ）で済ませ、クライアントには表示用文字列だけ渡す。

---

## 3. 構造リファクタリング

### R1. ソースレジストリ化 ★高

**現状**: 1 ソース追加するのに `route.ts` の 3 箇所（`SUPPORTED_SOURCE_IDS`、`if (selectedSource === ...)` ブロック、`normalize()` の `case`、`resultsBySource` のスプレッド）＋ `sources.ts` ＋ `types.ts` を触る必要がある。`route.ts` は 317 行のうち約 230 行がこの分岐。

```ts
// route.ts:210-247  — 9 個のほぼ同一 if
if (selectedSource === "zenn") { fetchPromises.push(searchZenn(20)); sourceOrder.push("zenn"); }
if (selectedSource === "qiita") { ... }
// ... × 9

// route.ts:264-282  — 同じ 9 ソースをもう一度列挙
const all = deduplicate([
  ...(resultsBySource.zenn ? resultsBySource.zenn.map((a) => normalize(a, "zenn")) : []),
  // ... × 9
]);
```

さらに `SUPPORTED_SOURCE_IDS`（route.ts）と `SOURCE_IDS`（sources.ts）が同じ内容を二重管理している。`hatena` だけ `await` してから `Promise.resolve()` で包む不整合もある（並列性を失っているが、単一ソース選択なので実害はない）。

**提案**: ソース定義を 1 箇所に集約する。

```ts
// src/lib/news/registry.ts
export interface SourceAdapter<T> {
  id: string;
  name: string; // UI 表示名（sources.ts を吸収）
  displayName: string; // normalize 時の sourceName
  fetch: (limit: number) => Promise<T[]>;
  toArticle: (item: T, sourceId: string) => NormalizedArticle;
}

export const SOURCE_REGISTRY = {
  zenn: {
    id: "zenn",
    name: "Zenn",
    displayName: "Zenn",
    fetch: searchZenn,
    toArticle: (z) => ({
      title: z.title,
      url: `https://zenn.dev${z.path}`,
      publishedAt: z.published_at,
      author: z.user?.name ?? z.user?.username ?? null,
      description: null,
      urlToImage: null,
    }),
  },
  // ...
} satisfies Record<string, SourceAdapter<any>>;

export const SOURCE_IDS = Object.keys(SOURCE_REGISTRY);
```

`route.ts` の POST は次まで縮む:

```ts
const adapter = SOURCE_REGISTRY[selectedSource];
if (!adapter) return NextResponse.json({ error: "unknown source" }, { status: 400 });

const raw = await adapter.fetch(FETCH_LIMIT);
const all = deduplicate(raw.map((item) => adapter.toArticle(item, adapter.id))).slice(
  0,
  MAX_ARTICLES,
);
```

- `normalize()` の `default` ケース（`as any` で場当たり的に拾っている）が不要になる
- `sources.ts` はレジストリからの導出に置き換わり、UI 一覧との乖離が構造的に起きなくなる
- `types.ts` の巨大 union 型（9 ソースの型を列挙）が消える
- テスト（`tests/fetch-news-source-selection.test.ts` など）はレジストリ単位の表駆動テストに置き換えられる

**移行手順**: レジストリを新規追加 → `normalize()` を薄いラッパとして残して既存テストを通す → 分岐ブロックを 1 つずつレジストリ参照に置換 → 全ソース移行後に `normalize()` と `SUPPORTED_SOURCE_IDS` を削除。

---

### R2. フィードアダプタの宣言的定義化 ★中

9 個のアダプタ実装のうち、実質的な差分は **URL と User-Agent の有無だけ**。

| パーサ  | ファイル                                              | 差分       |
| ------- | ----------------------------------------------------- | ---------- |
| RDF     | `zdnet.ts` / `xtech.ts` / `cloudwatch.ts`             | URL のみ   |
| RSS 2.0 | `itmedia.ts` / `codezine.ts` / `yamadashy.ts`         | URL + 型名 |
| Atom    | `qiita.ts`                                            | —          |
| 独自    | `zenn.ts`（JSON API） / `hatena.ts`（2 フィード合成） | —          |

`zdnet.ts` と `cloudwatch.ts` は変数名以外 1 文字も違わない。

```ts
// src/lib/news/feeds.ts
const UA = "news-watch/1.0 (+https://github.com/shunki/news-watch)";

export const RDF_FEEDS = {
  zdnet: { url: "https://feeds.japan.zdnet.com/rss/zdnet/all.rdf", headers: { "User-Agent": UA } },
  xtech: { url: "https://xtech.nikkei.com/rss/xtech-it.rdf", headers: { "User-Agent": UA } },
  cloudwatch: {
    url: "https://cloud.watch.impress.co.jp/data/rss/1.0/clw/feed.rdf",
    headers: { "User-Agent": UA },
  },
} as const;

export const createRdfSource = (cfg: FeedConfig, name: string) => async (limit: number) => {
  const xml = await fetchRssText(cfg.url, name, cfg);
  return xml ? parseRdf(xml).slice(0, limit) : [];
};
```

R1 のレジストリと組み合わせると、新規 RDF ソースの追加は**レジストリへの 1 行追加**になる。既存の `parseXtechRss` / `parseZdnetRss` / `parseCloudWatchRss` はテストが直接呼んでいるので、`parseRdf` への薄い re-export として残すか、テスト側を `parseRdf` に寄せる。

---

### R3. DB 層の整理

**(a) `db/actions.ts` は純粋な再エクスポートのみ（41 行中 41 行）**

```ts
/** Server Actions wrapper delegating to repository and query layers. */
export { upsertArticle, getScoredArticles /* ... */ };
```

- `"use server"` は無く、実際には Server Action ではない。名前が実体と乖離している
- 呼び出し側は `@/lib/db/actions` と `@/lib/db`（`vector-filter.ts` は後者を直接 import）が混在

いずれかに寄せる。推奨は `src/lib/db/index.ts` を「クライアント + 公開 API のバレル」にし、`actions.ts` を廃止して import 経路を 1 本化する。

**(b) `getTablePage` の `any` と動的カラム参照**

```ts
): Promise<{ rows: any[]; total: number }> {
  const colsRecord = tableObj as Record<string, any>;
  const colRef = colsRecord[sortCol] ?? colsRecord.id;
```

`getAllowedSortColumns()` で許可リスト検証しているので SQL インジェクションは防げているが、型の恩恵がゼロ。テーブルごとに `switch` で分岐して具体型を返すか、`TABLE_CONFIG` に列参照そのものを持たせて `Record<TableName, Record<string, AnyColumn>>` にする。

**(c) `countRows` の重複**

`getTablePage` 内の COUNT と、下部の `countRows()` が同一処理。`countRows` に統一する。

**(d) `getTablePage` の未使用引数**

`getTablePage(table, options)` の `options.table` と第 1 引数 `table` が重複しており、呼び出し側（`admin/db/[table]/page.tsx:27`）は両方に同じ値を渡している。`options` から `table` を除く。

**(e) `favorite-repository.ts` の未使用 import**

`import type { ArticleInsert }` を返り値型に使っているが、`ArticleInsert` は「挿入用の型」であり「取得結果の型」ではない（`id` を含まない）。そのため `bookmarks/page.tsx` で `as any` キャストが必要になっている。取得用の型（`ArticleListRow`）を別に定義する。

---

### R4. 死んだファイル・重複定数の削除

| 対象                            | 内容                                                  | 対応                            |
| ------------------------------- | ----------------------------------------------------- | ------------------------------- |
| `src/lib/llm/gemini.ts`         | 中身が `export * from "./index";` の 1 行             | 削除し import を `@/lib/llm` へ |
| `src/lib/scoring.ts:11-14`      | `MS_PER_SECOND` 等を `constants.ts:68-71` と二重定義  | `constants.ts` から import      |
| `src/lib/score-pipeline.ts:8-9` | `./constants` からの import 文が 2 行に分裂           | 統合                            |
| `src/lib/db/schema.ts:77`       | `// test` というコメントが残置                        | 削除                            |
| `src/lib/embeddings.ts:113`     | `const BATCH_SIZE = EMBED_BATCH_SIZE;` の無意味な別名 | 直接使用                        |
| `src/lib/vector-filter.ts:35`   | コメント内に簡体字 "查询" が混入                      | 表記統一                        |
| `article-repository.ts:3`       | `desc` を import しているが未使用                     | 削除（oxlint で検出可）         |
| `test.db`（リポジトリルート）   | 32KB の SQLite が git 管理下（`.gitignore` に無い）   | `git rm --cached` + ignore      |

---

### R5. 入力バリデーション

`zod` が既に依存にあるのに、外部入力の検証に使われていない。

```ts
// route.ts:193
const body = await request.json();
selectedSource = body.source || "zenn"; // ← 検証なし
```

```ts
// favorites/toggle/route.ts:7-10
const { articleId } = body;
if (typeof articleId !== "number" || isNaN(articleId)) {
  /* 手書き検証 */
}
```

```ts
const FetchNewsBody = z.object({ source: z.enum(SOURCE_IDS_TUPLE).default("zenn") });
const parsed = FetchNewsBody.safeParse(await request.json().catch(() => ({})));
if (!parsed.success) return NextResponse.json({ error: "invalid body" }, { status: 400 });
```

現状は未知の `source` を渡すと `fetchPromises` が空になり `fetched: 0` を静かに返す（`ok: true`）。エラーが表面化しないのは運用上の負債。

---

## 4. スコアリングの設計上の懸念

### C1. softmax による相対化がスコアの意味を壊している ★中

```ts
// scoring.ts:68-74
for (const [, group] of byKeyword) {
  const normalized = softmax(group.map((t) => t.similarity));
  for (let i = 0; i < group.length; i++) {
    group[i].similarity = normalized[i] * SOFTMAX_SCALE; // 合計が常に 10 になる
  }
}
```

softmax の出力は合計 1 なので、**あるキーワード群の relevance の平均は常に `10 / 群のサイズ`** になる。

| 群のサイズ | 平均 relevance | composite への寄与（×0.2） |
| ---------- | -------------- | -------------------------- |
| 1 件       | 10.0           | +2.0                       |
| 5 件       | 2.0            | +0.4                       |
| 20 件      | 0.5            | +0.1                       |

つまり「Claude 関連が 1 件しか取れなかった回」の記事は、それ自体の類似度に関わらず relevance 満点になる。逆に「Gemini 関連が大量に取れた回」の記事は全員が低評価になる。1 回の fetch は 20 記事上限なので、**同じ記事でも取得タイミングによってスコアが変わる**。

さらに実装上、softmax の入力はコサイン類似度（概ね 0.3〜0.8 の狭い範囲）なので、温度 1.0 の指数化ではほとんど差がつかず、結果は「均等割り」に近い。

**提案**（いずれか）:

- **A（推奨）**: 絶対値マッピングに変更。`relevance = clamp((cos - LOW) / (HIGH - LOW), 0, 1) * 10` のように、実測分布から `LOW`/`HIGH` を決める。バッチサイズ非依存になり、`refreshRecency` での再計算とも整合する
- **B**: softmax を残すなら温度を下げ（例 0.1）、かつ `× SOFTMAX_SCALE` ではなく `× group.length` で正規化して群サイズ依存を消す
- **C**: relevance を composite から外し、`TAGGING_THRESHOLD` によるフィルタ専用にする（weight を usefulness/recency に再配分）

いずれも `WEIGHT_SIMILARITY = 0.2` の重みと `tests/lib/scoring.test.ts` / `tests/qiita-scoring-repro.test.ts` 群の期待値に影響するため、spec §6「Scoring Formula」の更新が必須。

### C2. `normalizeSimilaritiesWithTagged` が引数を破壊的に変更

```ts
export function normalizeSimilaritiesWithTagged(tagged: ArticleWithTag[]): ArticleWithTag[] {
  // ...
  group[i].similarity = normalized[i] * SOFTMAX_SCALE; // 呼び出し元の配列要素を書き換え
  return tagged; // 同じ参照を返す
}
```

新しい配列を返しているように見えて実際は同一参照。Tier 1（>95% カバレッジ）の純粋ロジック層としては不適切。新オブジェクトを返す実装に変更する。

### C3. `softmax` の数値安定性

```ts
const exponents = values.map((v) => Math.exp(v / temperature));
```

最大値を引く標準的な安定化がない。現状の入力域（コサイン類似度）では溢れないが、C1-B で温度を下げると `exp(0.8 / 0.1) = e^8` となり、値域が広がると危険。`Math.exp((v - max) / temperature)` にしておく。

### C4. `cleanupOrphaned` が untagged 記事を回収しない

```ts
await db.delete(articles).where(notInArray(articles.keyword, activeKeywords));
```

SQL の三値論理により `NULL NOT IN (...)` は NULL（= 偽扱い）なので、`keyword IS NULL` の記事は永久に削除されない。`TAGGING_THRESHOLD` 未満の記事は `keyword: null` で保存される設計なので、**これらが無制限に蓄積する**。`cleanupLowScored` が拾うのはスコア 5 未満のみ。意図的なら明示コメントを、そうでなければ `or(isNull(keyword), notInArray(...))` にする。

---

## 5. 運用・セキュリティ

### S1. `/admin/db` が無認証で公開されている ★最優先

`src/app/admin/db/**` は middleware も認証チェックも無く、Vercel 上で誰でも到達できる。`robots: "noindex"` は検索避けであってアクセス制御ではない。公開されるのは:

- 全記事（URL・要約・LLM の評価理由・スコア）
- `keyword_embeddings`（= 監視キーワードの全リスト = 業務上の関心事）
- `favorites`

**対策の選択肢**:

1. `middleware.ts` で Basic 認証（環境変数の共有シークレット） — 最小工数
2. Vercel の Deployment Protection / Password Protection（Pro 以上）で `/admin/*` を保護
3. 本番ビルドから除外（`NEXT_PUBLIC_ENABLE_ADMIN` で `notFound()`）

商用デプロイ前に必ず塞ぐこと。

### S2. `/api/fetch-news` が無制限に叩ける

POST 1 回で Gemini の embedding + LLM 呼び出しが走る。認証もレート制限も無いため、**外部から API コストを消費させられる**。

- 最低限: `CRON_SECRET`（`.env.local.example` に定義済みだが未実装）による Bearer 検証、または Vercel の同一オリジンチェック
- UI からの手動実行を維持するなら、IP 単位の簡易レート制限（Vercel KV / Upstash）を挟む

### S3. spec と実装の乖離

spec §2.1 に「Periodic feed fetch via scheduled cron (QStash)」とあるが、`vercel.json` も cron ハンドラも存在せず、実際は UI ボタンからの手動実行のみ。商用運用なら Vercel Cron で定期実行する構成が自然:

```json
// vercel.json
{ "crons": [{ "path": "/api/fetch-news?source=zenn", "schedule": "0 */6 * * *" }] }
```

（Vercel Cron は GET のみなので、GET ハンドラの追加か `/api/cron/fetch` の新設が必要。現状の GET は説明文を返すだけ。）

実装しないなら spec からこの記述を落とす。**どちらでもよいが、乖離したままにしない。**

### S4. `.env.local.example` の陳腐化

`NEWS_API_KEY` / `CRON_SECRET` / `HATENA_PROXY_URL` はいずれも `src/` から参照が無く、`HATENA_PROXY_URL` のコメントが指す `src/lib/news/hatena-discovery.ts` は存在しない。`scripts/check-env.ts` の `REQUIRED` が実態（Turso × 2 + `GOOGLE_API_KEY`）なので、そちらに揃える。

---

## 6. 実行ロードマップ

各フェーズは独立してデプロイ可能。pre-push のカバレッジ段階検証（Tier 1: 95% 〜 Tier 6: 65%）を通す前提。

### フェーズ 1: 即効性のある性能・安全対策（〜1 日）

1. **S1** `/admin/db` に Basic 認証 middleware
2. **P1** `getScoredArticles` / `getFavoriteArticles` の列指定（`embedding`・`description` 除外）
3. **P3** `idx_source_score_pub` 追加（+ 未使用インデックス削除）
4. **P5-c/d** `drizzle-kit` を devDependencies へ、`.env.local.example` 整理
5. **R4** 死にファイル・重複定数の削除、`test.db` の untrack

→ 影響範囲が狭く、テスト修正もほぼ不要。ダッシュボードの体感が最も変わる区切り。

### フェーズ 2: I/O 効率化（〜2 日）

6. **P2** `refreshRecencyForSources` / `scoreAndSaveBatch` のバッチ化（フォールバック付き）
7. **P5-a** `schema.ts` → `embeddings.ts` の依存を切る、`genAI` の遅延初期化
8. **P5-b** `next.config.ts` の設定追加
9. **P4** `unstable_cache` + `revalidateTag("articles")`

→ `tests/db/actions.test.ts`・`tests/db/recency-refresh.test.ts` の修正が必要。

### フェーズ 3: 構造リファクタリング（〜3 日）

10. **R1** ソースレジストリ導入（`normalize()` を残したまま段階移行）
11. **R2** フィード定義の宣言化
12. **R5** zod による入力検証、**S2** fetch-news の保護
13. **R3** DB 層のバレル整理と `any` 排除

→ 最も差分が大きい。`tests/fetch-news-source-selection.test.ts`・`tests/api/fetch-news/normalize.test.ts` は表駆動に書き換え。

### フェーズ 4: 表示層とスコアリング（〜2 日）

14. **P7** 二重ソート削除、`ArticleList` の RSC 化 + favorites の props 化
15. **P6** LLM バッチ並列化、`waitUntil` での後処理追い出し
16. **C1〜C4** スコアリングの見直し（spec §6 更新を伴う）

→ **C1 は仕様変更**。既存記事のスコアが動くため、実施するなら再スコアリングの方針（全件再計算 or 自然入れ替え待ち）も決めること。

---

## 7. 計測方法

改善を主張する前に数字を取る。

| 対象                       | 計測方法                                                                              |
| -------------------------- | ------------------------------------------------------------------------------------- |
| RSC ペイロードサイズ（P1） | `curl -s https://<app>/ \| wc -c`、DevTools Network の document サイズ                |
| DB 往復回数（P2）          | Turso ダッシュボードの rows read / written、または `db` に計測ラッパを挟む            |
| クエリプラン（P3）         | `EXPLAIN QUERY PLAN SELECT ...` を Turso CLI で実行（`SCAN` の有無）                  |
| パイプライン所要時間（P6） | `POST /api/fetch-news` のレスポンスに区間タイムスタンプを追加、Vercel ログの Duration |
| コールドスタート（P5）     | Vercel Observability の Cold Start 時間、`next build` の Route サイズ表               |
| ダッシュボード load（NFR） | Lighthouse / Vercel Speed Insights（NFR 目標 < 2s）                                   |

`next build` 後の出力（First Load JS / Route サイズ）をフェーズごとに記録し、`docs/` に残すと退行を検知できる。

---

## 付録: 変更が spec に波及する項目

| 項目                       | spec の更新箇所                                                |
| -------------------------- | -------------------------------------------------------------- |
| P1（列の限定）             | §5 Data Model の補足（表示用列セット）                         |
| P3（インデックス変更）     | §5 Data Model「Indexes」                                       |
| P4（キャッシュ）           | §6 Data Flow、§4 NFR                                           |
| R1/R2（レジストリ）        | §6 Architecture / Data Flow、§7.1 Tier 3 の対象ファイル一覧    |
| R3（`db/actions.ts` 廃止） | §7.1 Tier 4、`check-spec-refs.sh` が参照切れを検出するため必須 |
| C1（スコア式）             | §3.1 FR-002、§6 Scoring Formula                                |
| S3（cron）                 | §2.1 In Scope                                                  |

`scripts/check-spec-refs.sh` が spec 内の `src/` / `tests/` パス参照の実在を pre-push で検証するため、**ファイル移動・削除を伴う項目は spec の更新を同一コミットに含めること**。

---

## 実装状況（2026-08-02 現在）

### フェーズ 1: 即効性のある性能・安全対策 ✅ **完了**

| 項目       | 状態    | コミット | 備考                                                                |
| ---------- | ------- | -------- | ------------------------------------------------------------------- |
| **S1**     | ✅ 完了 | Phase 1  | `/admin/db` に Basic 認証 middleware 追加                           |
| **P1**     | ✅ 完了 | Phase 1  | `ARTICLE_LIST_COLUMNS` でクライアントに送信する列を限定             |
| **P3**     | ✅ 完了 | Phase 1  | `idx_source_score_pub` 複合インデックス追加・未使用インデックス削除 |
| **P5-c/d** | ✅ 完了 | Phase 1  | `drizzle-kit` を devDependencies へ、`.env.local.example` 整理      |
| **R4**     | ✅ 完了 | Phase 1  | 死にファイル・重複定数削除、`test.db` を git 管理から除外           |

### フェーズ 2: I/O 効率化 ✅ **完了**

| 項目     | 状態    | コミット | 備考                                                                                         |
| -------- | ------- | -------- | -------------------------------------------------------------------------------------------- |
| **P2**   | ✅ 完了 | Phase 2  | `refreshRecencyForSources` / `scoreAndSaveBatch` のバッチ化（`db.batch()` + フォールバック） |
| **P5-a** | ✅ 完了 | Phase 2  | `schema.ts` → `embeddings.ts` の依存を切断、`genAI` 遅延初期化                               |
| **P5-b** | ✅ 完了 | Phase 2  | `next.config.ts` に `serverExternalPackages` / `optimizePackageImports` 設定                 |
| **P4**   | ✅ 完了 | Phase 2  | `unstable_cache` + `revalidateTag("articles")` でキャッシュ層導入                            |

### フェーズ 3: 構造リファクタリング ⚠️ **部分完了**

| 項目   | 状態    | コミット | 備考                                                               |
| ------ | ------- | -------- | ------------------------------------------------------------------ |
| **R1** | ✅ 完了 | Phase 3  | ソースレジストリ化（`SOURCE_ADAPTER` + `SOURCE_REGISTRY`）         |
| **R2** | ✅ 完了 | Phase 3  | フィード定義の宣言化（`RDF_FEEDS` / `RSS_FEEDS` 等）               |
| **R5** | ✅ 完了 | Phase 3  | zod による外部入力検証（`FetchNewsBody` schema）                   |
| **S2** | ✅ 完了 | 6d8614d  | `/api/fetch-news` Bearer 認証（`timingSafeEqual`）実装済み         |
| **R3** | ⚠️ 部分 | —        | (e) 型修正完了 / (a)-(d) 未実装（DB層バレル・`any`排除・重複削除） |

### フェーズ 4: 表示層とスコアリング ✅ **完了**

| 項目       | 状態    | コミット          | 備考                                                                         |
| ---------- | ------- | ----------------- | ---------------------------------------------------------------------------- |
| **P7-1**   | ✅ 完了 | Phase 4 (b057e91) | `NewsSection` の二重ソート削除（DB 信頼）                                    |
| **P7-2**   | ✅ 完了 | Phase 4 (b057e91) | `ArticleList` 未使用 `/api/favorites` GET フェッチ削除                       |
| **P7-3**   | ✅ 完了 | Phase 4 (b057e91) | `KEYWORD_LABELS` 解決をサーバーサイド（`resolveKeywordLabel()`）へ移動       |
| **P6-a/b** | ✅ 完了 | Phase 4 (b057e91) | LLM バッチ `p-limit` 並列化（並行度3）+ `getBatchSize` O(n²)→O(n) 最適化     |
| **C2**     | ✅ 完了 | Phase 4 (b057e91) | `normalizeSimilaritiesWithTagged` 非破壊化（新オブジェクト返却）             |
| **C3**     | ✅ 完了 | Phase 4 (b057e91) | `softmax` 数値安定化（log-domain: `exp((v - max) / temp)`）                  |
| **C4**     | ✅ 完了 | Phase 4 (b057e91) | `deleteOrphanedArticles` NULL キーワード対応（`or(isNull(), notInArray())`） |

### スコープ外

| 項目     | 理由                                                                          |
| -------- | ----------------------------------------------------------------------------- |
| **C1**   | softmax 相対化→絶対値マッピング（仕様変更、再スコアリング方針決定が別途必要） |
| **P6-c** | `after()` による後処理バックグラウンド化（テスト構造への影響が大きい）        |

---

### 検証結果（Phase 4 最終）

| 項目                  | 結果                       |
| --------------------- | -------------------------- |
| **テスト**            | 273 passed, 2 skipped ✅   |
| **TypeScript**        | 0 errors ✅                |
| **Tier 1 (Core)**     | 100% ✅                    |
| **Tier 2 (Pipeline)** | 90.57% ✅                  |
| **Tier 3 (Sources)**  | 95.65% ✅                  |
| **Tier 5 (UI)**       | 95.39% ✅                  |
| **Tier 6 (API)**      | 85.42% ✅                  |
| **全体進捗**          | **81.2%** (13/16 items) ✅ |

---

### 実装状況の修正（2026-08-02 時点）

以下の項目は「✅ 完了」と記載されていましたが、**実装されていません**：

| 項目     | 現状                                                     | 対応                                        |
| -------- | -------------------------------------------------------- | ------------------------------------------- |
| **R3-a** | DB層バレル統合未実装（`actions.ts` は re-export のまま） | 優先度：**低** — 8 箇所の import パスを統一 |
| **R3-b** | `getTablePage()` の `any` 型排除未実装                   | 優先度：低                                  |
| **R3-c** | `countRows()` 重複削除未実装                             | 優先度：低                                  |
| **R3-d** | `getTablePage()` 引数重複削除未実装                      | 優先度：低                                  |

**根本原因**: refactoring-plan.md が Phase 3 完了時点で「R3: ✅ 完了」と記載したが、実装との乖離があった。

### 今後のロードマップ

**短期（本番デプロイ前）**:

- ✅ spec.md 最新化完了（Phase 4 実装内容を反映）
- ✅ S1/S2 セキュリティ実装完了（認証・タイミングセーフ）
- 🚀 本番デプロイ可能状態

**中期（Phase 5 — 構造最適化）**:

- R3-a: DB層バレル統合（`actions.ts` → `lib/db/index.ts`）
- R3-b/c/d: `getTablePage()` の型安全化・DRY 化
- テスト修正（モック統一）

**オプション**:

- C1: softmax → 絶対値スコア（仕様変更、再スコアリング方針決定必須）

---

## Phase 5: R3 DB層構造最適化（詳細実行計画）

### R3-a: DB層バレル統合（優先度：高 / 難度：低）

**概要**: `src/lib/db/actions.ts` を廃止し、すべての import を `@/lib/db` に統一する。

**現状**:

- `actions.ts` は純粋な re-export バレル（47 行）
- 8 箇所から `@/lib/db/actions` を import
- `@/lib/db` から直接 import する箇所も混在

**修正内容** (作業量：**5-10 分**)：

```bash
# 1. 8 箇所の import パス変更
sed -i 's#@/lib/db/actions#@/lib/db#g' \
  src/app/page.tsx \
  src/app/bookmarks/page.tsx \
  src/app/api/fetch-news/pipeline/maintenance.ts \
  src/app/api/favorites/toggle/route.ts \
  src/app/api/favorites/route.ts \
  src/app/admin/db/page.tsx \
  src/lib/score-pipeline.ts \
  src/app/admin/db/[table]/page.tsx

# 2. actions.ts 削除
rm src/lib/db/actions.ts

# 3. index.ts が全エクスポートを含むことを確認（既に含む）

# 4. テスト実行
pnpm test
```

**テスト修正**: 不要（re-export なので）

**リスク**: 低（単純な import パス変更）

---

### R3-c & R3-d: getTablePage 軽微改善（優先度：中 / 難度：低）

#### R3-d: 引数重複削除

**現状**:

```ts
// admin/db/[table]/page.tsx:27
const result = await getTablePage(table, { table, sortCol, dir, limit });
```

引数 `table` と `options.table` が重複。

**修正** (作業量：**3-5 分**):

```ts
// 1. query/article-queries.ts
interface TablePageOptions {
  sortCol?: string;
  // 2. table を削除
  dir?: "asc" | "desc";
  limit?: number;
}

export async function getTablePage<T extends TableName>(
  table: T,
  options: TablePageOptions,
) { ... }

// 2. admin/db/[table]/page.tsx
const result = await getTablePage(table, { sortCol, dir, limit });
```

---

#### R3-c: countRows の重複削除

**現状**:

- `getTablePage` 内で各テーブルの COUNT を 3 箇所でインライン実装
- 別途 `countRows()` が定義されている

**修正** (作業量：**5-10 分**):

```ts
// 1. countRows を export
export async function countRows(tableObj: any): Promise<number> { ... }

// 2. getTablePage 内の COUNT インラインをまとめる
export async function getTableCounts() {
  return Promise.all([
    countRows(articles),
    countRows(keywordEmbeddings),
    countRows(favorites),
  ]);
}
```

---

### R3-b: getTablePage 型安全化（優先度：低 / 難度：中）

**ステータス**: ✅ 完了（2026-08-02）

**修正内容**: `src/lib/db/query/article-queries.ts` で Drizzle の `$inferSelect` 型とテーブル別行型マップを使用し、`getTablePage` の戻り値を `Promise<{ rows: TableRowMap[T][]; total: number }>` に型安全化。`any[]` 戻り値と `Record<string, any>` キャストを排除。

```ts
export type ArticleRow = typeof articles.$inferSelect;
export type KeywordEmbeddingRow = typeof keywordEmbeddings.$inferSelect;
export type FavoriteRow = typeof favorites.$inferSelect;

export type TableRowMap = {
  articles: ArticleRow;
  keyword_embeddings: KeywordEmbeddingRow;
  favorites: FavoriteRow;
};

export async function getTablePage<T extends TableName>(
  table: T,
  options: TablePageOptions<T>,
): Promise<{ rows: TableRowMap[T][]; total: number }> { ... }
```

**採用アプローチ**: オプション A の派生（`$inferSelect` + 行型マップ）。UI用 TABLE_CONFIG の構造は不変のまま、db 層の `tableMap` と型定義のみを強化。`Record<string, any>` → `Record<string, unknown>` に緩和し、残る `colRef as any` は Drizzle orderBy の動的列解決のため最小限に留めた（コメント添付）。

**検証結果**:

- tsgo --noEmit: ✅ エラー0
- vitest: ✅ 278 passed / 2 skipped / 0 failed（全件）
- oxlint: ✅ 追加エラーなし

**備考**: `TablePageOptions` をジェネリック化（`<T extends TableName = TableName>`）。テスト修正は不要だった（既存テストが型変更後もそのままパス）。

---

### 実装順序と作業量サマリー

| #   | 項目     | 難度 | 作業量     | テスト修正 | リスク | 実行       |
| --- | -------- | ---- | ---------- | ---------- | ------ | ---------- |
| 1   | **R3-a** | 低   | 5-10m      | 不要       | 低     | **推奨順** |
| 2   | **R3-d** | 低   | 3-5m       | 不要       | 低     | 次         |
| 3   | **R3-c** | 低   | 5-10m      | 不要       | 低     | 次         |
| 4   | **R3-b** | 中   | 30-40m     | 必要 (10m) | 中     | 最後       |
|     | **合計** | —    | **50-65m** | **10m**    | —      | —          |

**本番デプロイ前**: R3-a を必ず実施（他は optional）

**推奨フェーズ分け**:

- **Phase 5-α** (即時): R3-a のみ → 低リスク、即効果
- **Phase 5-β** (1 週間後): R3-c/d → 軽微改善
- **Phase 5-γ** (2 週間後): R3-b → 型安全化（時間あるなら）

---

## 実装進捗（2026-08-02 実装開始）

### R3-a バレル統合

**ステータス**: ✅ 完了（2026-08-02）

| タスク                 | 状態    | 詳細                                                   |
| ---------------------- | ------- | ------------------------------------------------------ |
| (1) src/ import 修正   | ✅ 完了 | 8 箇所を @/lib/db に統一（page.tsx他）                 |
| (2) actions.ts 削除    | ✅ 完了 | src/lib/db/actions.ts 削除完了                         |
| (3) tests/ import 修正 | ✅ 完了 | 相対パス + @/lib/db パス完全置換                       |
| (4) テスト             | ✅ 完了 | **273 passed / 2 skipped / 0 failed**                  |
| **実装状況**           | ✅ 完了 | **コア実装 + モック修正 + 未使用 import 整理まで完了** |

**根本原因（テスト失敗 58 → 27）**: vi.mock("@/lib/db") が実モジュールとは別の `:memory:` クライアントを作成していたため、テストが書き込んだ DB とリポジトリ関数が参照する DB が分離し、データ状態の不一致が発生。

**最終修正方針（fix-1 / fix-2）**:

1. テストの `vi.mock("@/lib/db", ...)` を `{ ...actual, __client: (actual as any).db.$client }` に統一 — 実モジュールの `db.$client` を `__client` として公開し、テストとリポジトリ関数で同一 DB インスタンスを共有
2. 影響を受けたテスト 6 ファイル（tests/db/actions・favorites・recency-refresh・scored-articles-source-display・tests/integration/bug-zero-scored-articles・tests/e2e/real-llm）のモック定義を修正
3. 未使用 import（createClient / drizzle / schema）を削除

**実装統計**:

- 修正ファイル: src/ 8 個 + tests/ 42 個 + index.ts
- actions.ts: 削除完了
- index.ts: 統合完了（20+ エクスポート）
- TypeScript エラー（tsgo --noEmit）: 0
- lint:fast: 0 エラー / 75 警告（pre-existing で許容）

**テスト最終結果**:

| 検証                     | 結果                                              |
| ------------------------ | ------------------------------------------------- |
| vitest                   | ✅ 278 passed / 2 skipped / 0 failed              |
| tsgo --noEmit            | ✅ エラーなし                                     |
| lint:fast                | ✅ 0 エラー（75 警告は許容）                      |
| カバレッジ tier チェック | ✅ **全ティア PASS**（Tier 2: 98.41% / 目標 85%） |

**カバレッジ Tier 2 解消（fix-3）**: `tests/api/fetch-news/route.test.ts` に +113 行追加。CRON_SECRET 認証ガード（401系）、不正ソース名（400）、deduplicate の catch フォールバック、記事0件分岐、`normalize` 直接単体テストを追加。Tier 2 を 79.38% → **98.41%** に改善。

**R3-b 型安全化 完了（exp-2 / fix-4）**: `src/lib/db/query/article-queries.ts` で Drizzle `$inferSelect` + テーブル別行型マップ（`TableRowMap`）を導入し、`getTablePage` の戻り値を `Promise<{ rows: TableRowMap[T][]; total: number }>` に型安全化。`any[]` 戻り値と `Record<string, any>` キャストを排除。採用アプローチはオプション A の派生で、UI用 `TABLE_CONFIG` の構造は不変。テスト修正は不要（既存テストが型変更後もそのままパス）。詳細は「R3-b: getTablePage 型安全化」セクション参照。

**検証結果（R3-a + カバレッジ + R3-b 累計）**:

| 検証                     | 結果                                              |
| ------------------------ | ------------------------------------------------- |
| vitest                   | ✅ 278 passed / 2 skipped / 0 failed              |
| tsgo --noEmit            | ✅ エラーなし                                     |
| oxlint                   | ✅ 追加エラーなし                                 |
| カバレッジ tier チェック | ✅ **全ティア PASS**（Tier 2: 98.41% / 目標 85%） |

**コミット**: ✅ `8b1dd13`（`origin/master` にプッシュ済み）`refactor: R3-c/d getTablePage の countRows 統一と引数重複削除 + R3-a/b コミット`

---

### R3-c & R3-d 完了（2026-08-02）

**ステータス**: ✅ 完了（R3-a/b/c/d 全項目完了）

| 項目     | 状態    | 詳細                                                                                                                                       |
| -------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| **R3-c** | ✅ 完了 | `getTablePage` 内のインライン COUNT を `countRows()` 呼び出しに統一（DRY 化）                                                              |
| **R3-d** | ✅ 完了 | `TablePageOptions` から `table` を除去、呼び出し側（`admin/db/[table]/page.tsx` + テスト10箇所）を `{ offset, limit, sort?, dir? }` に修正 |

**検証結果（R3-a/b/c/d 累計）**:

| 検証                     | 結果                                                   |
| ------------------------ | ------------------------------------------------------ |
| vitest                   | ✅ 278 passed / 2 skipped / 0 failed                   |
| tsgo --noEmit            | ✅ エラーなし                                          |
| lint:fast                | ✅ 0 エラー                                            |
| カバレッジ tier チェック | ✅ **全ティア PASS**                                   |
| pre-push フック          | ✅ 通過（spec-refs / schema-consistency / カバレッジ） |

**spec.md 同期**: `src/lib/db/actions.ts` → `src/lib/db` に参照を更新（`check-spec-refs.sh` 通過）。

**Phase 5 完了**: R3-a/b/c/d 全項目が実装・検証・コミット・プッシュ済み。残るスコープ外は C1（softmax→絶対値スコア、仕様変更）と P6-c（`after()` 後処理バックグラウンド化）。
