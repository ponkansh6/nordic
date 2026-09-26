# Nordic: ソース取得・採点・記事表示

## 目的と範囲

Nordic は北欧デザイン、暮らし、美容に関する記事を定期取得し、日本語の要約と評価を付けて一覧表示する公開アプリである。現行のニュースソース、ソース選択、キーワード、ブックマーク、NFM、嗜好分析、DB管理画面は提供しない。

取得元は次の2つに限定する。

| ソース           | フィード                                   | 記事一覧のフォールバック              |
| ---------------- | ------------------------------------------ | ------------------------------------- |
| Dezeen · Finland | `https://www.dezeen.com/tag/finland/feed/` | `https://www.dezeen.com/tag/finland/` |
| Lumene           | `https://www.lumene.com/blogs/news.atom`   | `https://www.lumene.com/blogs/news`   |

Finnish Design Shop はフィード・記事一覧とも本番実行環境から HTTP 403 となるため対象外とする。Good News from Finland は更新終了のため対象外とする。公開が確認できた RSS/Atom を優先し、ない場合や利用できない場合は各サイトの記事一覧から最新記事を探す。抜粋が不足している場合は、許可された同一サイトの記事ページから要約用テキストだけを取得する。`robots.txt` の 4xx 応答は RFC 9309 の unavailable として扱って一覧取得を試す。5xx、接続障害、TLS エラーでは取得を停止し、記事ページ自体の拒否応答も保存しない。

## 取得と永続化

- 毎日 21:00 UTC（日本時間 06:00）に Vercel Cron が `GET /api/ingest` を呼び出す。
- 公開画面の「最新記事を取得」ボタンは `POST /api/ingest` を呼び出し、設定済み2ソースをまとめて更新する。
- 1ソースにつき最新候補を最大20件取得する。ソースをまたいだ合計件数上限は設けない。
- URL を正規化して重複を除き、既知の記事は再採点しない。履歴のバックフィルは行わず、運用開始後に取得した新しい記事のみ追加する。
- 記事の本文全体は保存しない。フィードまたは記事一覧から得たタイトル、抜粋、URL、公開日時と、LLM の要約・評価結果を保存する。
- `nordic_sources` と `nordic_articles` を既存の `articles` 等から分離する。既存テーブルと保存済みデータは変更・移行・削除しない。Nordic の記事・実行状態のテーブルは新規作成し、ソースマスタに2ソースを登録する。Nordic の Drizzle スキーマ、migration ファイル、適用履歴は既存履歴から分離する。ソースを置き換える場合、既存記事が紐づくソース行を削除せず、置換後のソース行を追加する。
- 各 Nordic 記事は `source_id` 外部キーでソース1件に所属する。ソース1件に複数記事を対応させる（1対多）。

## 要約と評価

- LLM は記事タイトルと取得できた抜粋を基に、日本語の短い要約、北欧デザインとの関連度（0〜10）、日本語の評価理由を作る。
- 合成スコアは `北欧デザインとの関連度 × 0.8 + 新しさ × 0.2` とし、0〜10の範囲で保存する。
- 新しさは公開日時から機械的に算出する。1日以内=10、3日以内=8、7日以内=6、14日以内=4、30日以内=2、それより古い/日時不明=0。
- 記事のタイトルは原文のまま表示する。要約と評価理由は日本語で表示する。
- 全記事を表示し、合成スコアの降順、公開日時の降順で並べる。スコアによる表示下限や件数制限は設けない。

## 更新の排他とクールダウン

- 手動更新は共有DBで管理するグローバルな12時間クールダウンを持つ。
- 新しい本番デプロイを最初に確認したとき、前回の手動クールダウンを解除する。Preview とローカル環境は本番クールダウンを解除しない。
- Cron は手動クールダウンを無視する。
- Cron と手動更新は同じDBリースを使い、同時に2つの取得処理が走らないようにする。
- Cron の GET は `Authorization: Bearer <CRON_SECRET>` を要求する。手動 POST は公開画面から利用でき、ブラウザーのクロスオリジン要求は拒否する。

## データモデル

Nordic の migration は `src/lib/db/nordic-migrations/` に保存し、既存プロジェクトの Drizzle 履歴に触れないよう `__drizzle_migrations_nordic` に記録する。

### `nordic_sources`

| 列           | 用途                           |
| ------------ | ------------------------------ |
| `id`         | 安定したソース識別子（主キー） |
| `name`       | 一覧表示名                     |
| `site_url`   | 公式記事一覧URL                |
| `feed_url`   | RSS/Atom URL                   |
| `created_at` | 登録日時                       |

### `nordic_articles`

| 列                                                     | 用途                                  |
| ------------------------------------------------------ | ------------------------------------- |
| `id`                                                   | 主キー                                |
| `source_id`                                            | `nordic_sources.id` 外部キー          |
| `url`                                                  | 記事URL、重複防止用ユニークキー       |
| `title`, `description`, `url_to_image`, `published_at` | 取得メタデータ                        |
| `summary`                                              | LLM による日本語要約                  |
| `nordic_relevance`                                     | LLM による北欧デザイン関連度（0〜10） |
| `recency`                                              | 公開日時に基づく新しさ（0〜10）       |
| `score`                                                | 0.8/0.2 の合成スコア                  |
| `reason`                                               | 日本語の評価理由                      |
| `scored_at`, `created_at`                              | 評価日時、保存日時                    |

### `nordic_job_state`

グローバル手動クールダウン期限、本番デプロイ識別子、Cron/手動共通の実行リースを保持するキー・値テーブル。

## 環境変数

- `TURSO_DATABASE_URL`: Turso/libSQL 接続先
- `TURSO_AUTH_TOKEN`: Turso 認証トークン
- `GOOGLE_API_KEY`: Gemini API キー
- `CRON_SECRET`: Vercel Cron の Bearer 認証に使う秘密値
- `VERCEL_ENV`, `VERCEL_DEPLOYMENT_ID` または `VERCEL_GIT_COMMIT_SHA`: Vercel が設定する本番デプロイ判定値

## 画面

- `/` は公開ページで、全記事をスコア順に一覧表示する。
- 記事カードに原文タイトル、リンク、ソース名、公開日、日本語要約、スコア、スコア内訳、評価理由を表示する。
- 手動更新ボタンには処理状態と、クールダウン中は次回利用までのおおよその時間を表示する。
- ブックマーク、嗜好分析、ソース切り替え、管理者DBビューアー、NFM 操作は提供しない。

## 主な実装箇所

- `src/lib/nordic/sources.ts`: RSS/Atom と公式一覧ページからの記事取得
- `src/lib/nordic/score.ts`: Gemini による日本語要約と北欧関連度評価
- `src/lib/nordic/ingest.ts`: 重複排除、スコア合成、保存とトリガー制御
- `src/lib/nordic/state.ts`: 手動クールダウン、本番デプロイ識別、実行リース
- `src/lib/db/nordic-schema.ts`, `src/lib/db/nordic.ts`: Nordic 専用スキーマとデータアクセス
- `src/lib/db/nordic-migrations/`: Nordic 専用のスキーマ migration
- `src/app/api/ingest/route.ts`: 公開手動更新と認証済みCron
- `src/app/page.tsx`, `src/app/fetch-button.tsx`: 公開記事一覧と手動更新操作
