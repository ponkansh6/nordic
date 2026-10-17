#!/usr/bin/env bash
set -uo pipefail

ROOT=$(git rev-parse --show-toplevel 2>/dev/null || pwd)
cd "$ROOT"

# 開発環境だけに含まれる依存を独立して判定する。High / Critical は advisory とし、
# push は止めずに更新可能な依存と経路を表示する。
DEV_AUDIT_JSON=$(timeout 20 pnpm audit --dev --audit-level=high --json 2>/dev/null || true)
DEV_HAS_VULN=$(node -e '
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
' "$DEV_AUDIT_JSON")

if [ "$DEV_HAS_VULN" = "PARSE_ERROR" ]; then
  if [ -n "${CI:-}" ]; then
    echo "[security:development] ❌ pnpm audit の解析に失敗しました (CI 環境)"
    exit 1
  fi
  echo "[security:development] ⚠ 監査結果を取得できませんでした（ネットワーク/レジストリ到達不能、または timeout）。ローカルではスキップします。"
elif [ "$DEV_HAS_VULN" = "YES" ]; then
  echo ""
  echo "[warn] 開発依存(--dev) に High/Critical 脆弱性があります（advisory・push はブロックしません）"
  timeout 20 pnpm audit --dev --audit-level=high || true
else
  echo "[security:development] ✅ 開発依存に High/Critical 脆弱性なし"
fi
