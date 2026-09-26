# Git Hooks 対処ルール

コミット / push 時にフックの warning や error が発生した場合の対処方法。フックは Husky で有効化される。`--no-verify` や `HUSKY=0` で迂回しない。

## pre-commit

次の順で実行する。

1. `lint-staged` — staged ファイルを整形し、TypeScript / TSX は関連テストも実行する。対象ファイルには `secretlint` も実行する。
2. `oxlint --nextjs-plugin --react-plugin --react-perf-plugin` — リポジトリ全体を静的解析する。
3. `tsgo --noEmit` — リポジトリ全体を型チェックする。
4. `scripts/check-spec-update.sh` — `src/` / `tests/` の変更に対して仕様書の更新漏れを warning で知らせる。

warning は内容を確認し、必要なら `openspec/specs/news-watch/spec.md` を更新する。静的解析、型チェック、関連テスト、秘密情報検査が失敗した場合は原因を修正してから再コミットする。

## pre-push

未コミットの tracked 変更と `src/` / `tests/` の未追跡ファイルがある場合は、最初に push を止める。その他の未追跡ファイルは warning を出す。検査対象は push 差分に基づいて決まる。

常時、次の検査を並列レーンで実行する。

- **レーン A:** `scripts/check-lockfile-sync.sh`、`eslint src/`、`scripts/check-spec-refs.sh`、`oxfmt --check .`、`scripts/check-security.sh`
- **レーン B:** 依存関係、`src/`、`tests/`、型設定、coverage 設定などを変更した場合に `vitest run --coverage` と coverage tier 検査

`src/`、静的アセット、Next.js / TypeScript 設定、依存関係、smoke test を変更した場合は `scripts/smoke-test.sh` も実行する。`src/` の変更に対して `tests/` の変更がない場合は warning が出るため、既存テストで十分に検証されているか確認する。

### 失敗時の対処

- **lockfile sync:** 依存を変更したら `pnpm install` を実行し、`package.json`、`pnpm-workspace.yaml` を変更した場合は `pnpm-lock.yaml` も同期してコミットする。
- **ESLint / format:** エラーまたは整形差分を修正する。pre-commit の `oxfmt --write` は staged ファイルを対象にする。
- **spec refs:** `openspec/specs/news-watch/spec.md` の `src/` / `tests/` 参照を実在するパスに合わせる。
- **security:** 本番依存の High / Critical 脆弱性と secretlint 検出は blocking。依存を更新するか、秘密情報をファイルや Git 履歴から除去する。devDependency の監査結果は warning のみ。
- **coverage tiers:** `scripts/check-coverage-tiers.mjs` が示す未達モジュールを確認し、担当する既存テストを更新する。
- **smoke test:** ビルド、サーバー起動、トップページの描画エラーを確認する。`SMOKE_PORT`（既定 3100）が使用中の場合は `ss -tlnp` で確認し、該当プロセスを終了してから再実行する。

### 本番スキーマ drift

`src/lib/db/schema.ts` またはマイグレーションを変更し、`.env.local` に Turso 認証情報がある場合、pre-push は本番スキーマ drift 検出を advisory として実行する。ネットワークや認証に依存するため push は止めない。検出内容を確認し、本番スキーマへの変更は作業指示で明示された場合にのみ適用する。

## 仕様書の更新

機能仕様、データモデル、環境変数、アーキテクチャの正本は `openspec/specs/news-watch/spec.md`。機能やデータアクセスの振る舞いを変更した場合は、同じ変更に仕様書を合わせる。
