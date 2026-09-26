# 開発ルール

## 仕様と設計

- 機能仕様、データモデル、環境変数、アーキテクチャの正本は `openspec/specs/news-watch/spec.md` とする。`AGENTS.md` に同じ技術情報を重複して書かない。
- `src/` や `tests/` の振る舞いを変更したら、必要に応じて `spec.md` も同じ変更に合わせる。
- テストは既存の担当モジュールに追加・更新する。新しいテストファイルを作る前に、既存のテストで同じ振る舞いを検証していないか確認する。

## パッケージ管理

- パッケージマネージャーは `package.json` の `packageManager` で指定された pnpm を使う。`npm`、`npx`、`bun` でのインストールや実行はしない。
- Node.js と pnpm は `package.json` の `engines` および `packageManager` に記載されたバージョンを使う。
- `pnpm-workspace.yaml` の依存関係上書き設定を維持し、npm による lockfile の再生成をしない。

## Git フック

- コミット・push の前に Husky のチェックを通す。`--no-verify`、`HUSKY=0` などでフックを迂回しない。
- フックのエラーは原因を修正してから再実行する。warning も内容を確認し、必要なテスト・仕様書・ドキュメントの更新に反映する。
- フックの実行内容と対処方法は `docs/git-hooks.md` を参照する。
- `.husky/`、`scripts/check-*.sh`、依存ツールやチェックの構成を変更した場合は、`docs/git-hooks.md` と `docs/tooling.md` も同期する。

## 認証情報とデータベース

- `.env.local` などの秘密情報を含むファイルを表示・コピー・コミットしない。必要な変数名と例は `.env.local.example` を使う。
- 本番 Turso データベースの変更やスキーマ適用は、作業指示で本番反映が明示されている場合に限る。ローカルの検査結果だけを根拠に本番へ `drizzle-kit push` を実行しない。

## プロジェクトの確認

- 主な確認コマンドは `package.json` の scripts を参照する。フックのブロックチェックの詳細は `docs/git-hooks.md` にある。
- UI や API の挙動を変更する場合は、画面仕様だけでなく関連するデータアクセス、認証、エラー処理への影響も確認する。
