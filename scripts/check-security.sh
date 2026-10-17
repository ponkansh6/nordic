#!/usr/bin/env bash
set -u

ROOT=$(git rev-parse --show-toplevel 2>/dev/null || pwd)
cd "$ROOT"

# 各判定を独立して実行し、本番の blocking 結果があっても開発 advisory と
# secretlint の結果まで表示する。
FAILED=0
bash scripts/check-security-production.sh || FAILED=1
bash scripts/check-security-development.sh || FAILED=1
bash scripts/check-secrets.sh || FAILED=1

if [ "$FAILED" -ne 0 ]; then
  exit 1
fi

echo "[security] ✅ OK"
