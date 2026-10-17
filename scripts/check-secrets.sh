#!/usr/bin/env bash
set -uo pipefail

# pnpm exec は不規則な node_modules 状態で暗黙の install を試すことがあるため、
# フックと CI から直接呼べるよう local bin を PATH に追加する。
ROOT=$(git rev-parse --show-toplevel 2>/dev/null || pwd)
PATH="$ROOT/node_modules/.bin:$PATH"
export PATH

echo "[security] Running secretlint..."
secretlint "**/*"
