#!/usr/bin/env bash
set -uo pipefail

# secretlint は pnpm ラッパー経由で呼ばない。`pnpm exec` は実行前に
# 依存状態チェック（runDepsStatusCheck）を走らせ、node_modules が
# シンボリックリンクなどイレギュラーな状態だと `pnpm install` を試みて
# ERR_PNPM_ABORTED_REMOVE_MODULES_DIR_NO_TTY で失敗する。フック内から
# 暗黙に install が走るのは事故のもとなので直 bin を使う
# （フック本体と同じ方針。CI から直接叩かれても効くようここで PATH を張る）。
ROOT=$(git rev-parse --show-toplevel 2>/dev/null || pwd)
PATH="$ROOT/node_modules/.bin:$PATH"
export PATH

# --prod: blocking 判定は本番依存だけを見る。実測 2026-08-21 時点で
# `pnpm audit --audit-level=high` は high 24 + critical 1 件を検出するが、
# 全件が devDependency の推移依存（vercel CLI 配下の tar/undici/
# path-to-regexp/minimatch/js-yaml、eslint/depcheck 配下の brace-expansion、
# @tailwindcss/postcss 配下の nanoid/postcss）で、本番バンドルには一つも
# 乗らない。`--prod` はこれらをクリーンに保つ（実測: 0/0/0/0）。
# 自力で直せない上流の推移依存を blocking にすると着地直後から全 push が
# 失敗し、AGENTS.md が禁じている --no-verify の常用を誘発する。
#
# pnpm audit にはタイムアウトが無い（npm registry の fetch-timeout 既定 60s
# × retry でハングし得る）。preflight レーンを巻き込んで固まらないよう
# timeout で包み、タイムアウト時は既存の PARSE_ERROR パス
# （ローカルはスキップ・CI は fail）に倒す。
AUDIT_JSON=$(timeout 20 pnpm audit --prod --audit-level=high --json 2>/dev/null || true)

# Parse audit output using node to check for vulnerabilities
HAS_VULN_RESULT=$(node -e '
try {
  const data = JSON.parse(process.argv[1]);
  const vuln = data.metadata?.vulnerabilities;
  if (vuln && typeof vuln === "object") {
    const high = vuln.high || 0;
    const critical = vuln.critical || 0;
    console.log(high + critical > 0 ? "YES" : "NO");
  } else {
    console.log("NO");
  }
} catch {
  console.log("PARSE_ERROR");
}
' "$AUDIT_JSON")

if [ "$HAS_VULN_RESULT" = "PARSE_ERROR" ]; then
  if [ -n "${CI:-}" ]; then
    echo "[security] ❌ pnpm audit の解析に失敗しました (CI 環境)"
    exit 1
  else
    echo "[security] ⚠ pnpm audit を実行できませんでした（ネットワーク/レジストリ到達不能、または timeout）。ローカルではスキップします。"
  fi
elif [ "$HAS_VULN_RESULT" = "YES" ]; then
  echo ""
  echo "[security] ❌ 本番依存(--prod) に High/Critical 脆弱性が検出されました"
  pnpm audit --prod --audit-level=high
  exit 1
else
  echo "[security] ✅ 本番依存(--prod) に High/Critical 脆弱性なし"
fi

# --- devDependency 側は advisory ---
# devDependency の脆弱性はビルド成果物に含まれないため push はブロック
# しないが、開発環境自体のリスク（CI ランナー汚染など）として可視化だけ
# 行う。pnpm audit の結果は「push するコード」ではなく「advisory DB の
# 更新」で変わるものなので、非ブロッキングにするのが設計方針と整合する。
DEV_AUDIT_JSON=$(timeout 20 pnpm audit --audit-level=high --json 2>/dev/null || true)
DEV_HAS_VULN=$(node -e '
try {
  const data = JSON.parse(process.argv[1]);
  const vuln = data.metadata?.vulnerabilities;
  if (vuln && typeof vuln === "object") {
    const high = vuln.high || 0;
    const critical = vuln.critical || 0;
    console.log(high + critical > 0 ? "YES" : "NO");
  } else {
    console.log("NO");
  }
} catch {
  console.log("PARSE_ERROR");
}
' "$DEV_AUDIT_JSON")
if [ "$DEV_HAS_VULN" = "YES" ]; then
  echo ""
  echo "[warn] devDependency に High/Critical 脆弱性があります（advisory・push はブロックしません）"
  echo "       詳細: pnpm audit --audit-level=high"
fi

echo "[security] Running secretlint..."
if ! secretlint "**/*"; then
  echo "[security] ❌ secretlint 検出エラー"
  exit 1
fi

echo "[security] ✅ OK"
exit 0
