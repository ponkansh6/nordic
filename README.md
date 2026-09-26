# Nordic

Dezeen Finland と Lumene の最新記事を集約し、日本語の要約と北欧デザインとの関連性スコアを付けて読む Next.js アプリです。記事の収集と評価には Google Gemini API、永続化には Turso（libSQL）を使います。

## 開発環境

- Node.js 24.x
- pnpm 11.9 以降（11.x）
- Turso データベースと Google API キー

## 起動

```sh
pnpm install --frozen-lockfile
cp .env.local.example .env.local
```

`.env.local` に `TURSO_DATABASE_URL`、`TURSO_AUTH_TOKEN`、`GOOGLE_API_KEY` を設定してから起動します。Vercel Cron を使う本番環境では `CRON_SECRET` も設定します。

```sh
pnpm dev
```

ブラウザーで [http://localhost:3000](http://localhost:3000) を開きます。必須環境変数は次のコマンドで確認できます。

```sh
pnpm check-env
```

## 主なコマンド

```sh
pnpm test                 # テスト
pnpm lint:fast            # 高速 lint
pnpm type-check:fast      # TypeScript 型チェック
pnpm build                # 本番ビルド
pnpm db:generate          # Nordic 専用 Drizzle マイグレーション生成
pnpm db:migrate           # Nordic 専用の移行履歴へ未適用 migration を適用
pnpm db:studio            # Drizzle Studio で DB を確認
```

データベースのスキーマ変更は `pnpm db:generate` で `src/lib/db/nordic-migrations/` に migration を作成します。Nordic 用 migration の適用履歴は `__drizzle_migrations_nordic` に記録し、継承した他プロジェクトの履歴には触れません。適用先を確認し、運用手順に従って `pnpm db:migrate` を実施してください。記事は毎日06:00（日本時間）に自動取得し、手動更新は12時間ごとに実行できます。

機能仕様とアーキテクチャは [`openspec/specs/news-watch/spec.md`](openspec/specs/news-watch/spec.md)、フックや開発ツールの詳細は [`docs/git-hooks.md`](docs/git-hooks.md) と [`docs/tooling.md`](docs/tooling.md) を参照してください。

## セキュリティ

`.env.local` などの環境変数ファイルや認証情報はコミットしないでください。`.env.local` は Git の追跡対象外です。ニュースソースへアクセスする際は、各サイトの利用規約と `robots.txt` を守ってください。
