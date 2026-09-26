# 開発ツール

## Node.js と pnpm

- Node.js 24.x を使う。正確な対応範囲は `package.json` の `engines.node` を参照。
- pnpm 11.9.x を使う。プロジェクトで指定されたバージョンは `package.json` の `packageManager` を参照。
- 依存の追加・更新は pnpm で行い、`pnpm-lock.yaml` を `package.json` と同期する。`npm`、`npx`、`bun` でインストールや実行をしない。
- `pnpm-workspace.yaml` の `allowBuilds` と `overrides` は依存のビルド許可と脆弱性修正を管理するため、意図せず削除しない。
- Nordic のスキーマ変更は `pnpm db:generate` で `src/lib/db/nordic-migrations/` に生成する。`drizzle.config.ts` は Nordic 専用スキーマと `__drizzle_migrations_nordic` を指定し、継承した他プロジェクトの migration 履歴を実行しない。
- migration の適用先を確認してから `pnpm db:migrate` を実行する。

## Git Hooks

- Husky の pre-commit は整形、staged ファイルの秘密情報検査、関連テスト、静的解析、型チェックを行う。
- pre-push は lockfile、Lint、仕様書参照、整形、依存監査を確認する。push 差分に応じて coverage とスモークテストも実行する。
- warning / error の意味と対処手順は [docs/git-hooks.md](git-hooks.md) を参照。
- フックを `--no-verify` や `HUSKY=0` で迂回しない。

## スモークテスト（`scripts/smoke-test.sh`）

- 実行: `bash scripts/smoke-test.sh`。pre-push ではアプリ、依存、ビルド設定、静的アセット、テストスクリプトの変更時に実行する。
- Next.js の production build とサーバー起動後、トップページが描画され、RSC エラーや cookie 書き込みエラーがないことを確認する。
- `SMOKE_PORT` の既定値は 3100。ポートが使用中なら `ss -tlnp` で確認し、残っている該当サーバーを終了して再実行する。
- テストスクリプトはサーバーを独立したプロセスグループで起動し、終了時に後始末する。

## CI（`.github/workflows/ci.yml`）

GitHub Actions は Node.js 24 を使い、依存インストール、静的解析、型チェック、テストと coverage tier、仕様書参照、依存監査、スモークテストを実行する。push 前フックの詳細は `docs/git-hooks.md` を参照。
