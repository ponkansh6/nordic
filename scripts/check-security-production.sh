#!/usr/bin/env bash
set -uo pipefail

ROOT=$(git rev-parse --show-toplevel 2>/dev/null || pwd)
cd "$ROOT"

# 本番に含まれる dependencies / optionalDependencies の High / Critical を blocking にする。
# pnpm audit にタイムアウトがないため、pre-push がレジストリ待ちで固まらないよう制限する。
AUDIT_JSON=$(timeout 20 pnpm audit --prod --audit-level=high --json 2>/dev/null || true)
HAS_VULN_RESULT=$(node -e '
try {
  const data = JSON.parse(process.argv[1]);
  const vuln = data.metadata?.vulnerabilities;
  if (vuln && typeof vuln === "object") {
    console.log((vuln.high || 0) + (vuln.critical || 0) > 0 ? "YES" : "NO");
  } else {
    console.log("NO");
  }
} catch {
  console.log("PARSE_ERROR");
}
' "$AUDIT_JSON")

if [ "$HAS_VULN_RESULT" = "PARSE_ERROR" ]; then
  if [ -n "${CI:-}" ]; then
    echo "[security:production] ❌ pnpm audit の解析に失敗しました (CI 環境)"
    exit 1
  fi
  echo "[security:production] ⚠ 監査結果を取得できませんでした（ネットワーク/レジストリ到達不能、または timeout）。ローカルではスキップします。"
elif [ "$HAS_VULN_RESULT" = "YES" ]; then
  echo ""
  echo "[security:production] ❌ 本番依存(--prod) に High/Critical 脆弱性があります"
  timeout 20 pnpm audit --prod --audit-level=high || true
  exit 1
else
  echo "[security:production] ✅ 本番依存に High/Critical 脆弱性なし"
fi
