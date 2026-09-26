#!/usr/bin/env bash
# check-spec-update.sh
# Pre-commit check: if spec-sensitive files are staged, warn if spec.md is not.
# Non-blocking — always exits 0.
#
# Two-layer detection:
#   1) STATIC PATTERNS — manually curated list of spec-critical paths
#   2) DYNAMIC EXTRACTION — parses spec.md for `src/...` and `tests/...` references
#
# If any staged file matches either layer, and spec.md is NOT staged, a warning
# is printed.

set -euo pipefail

SPEC_FILE="openspec/specs/news-watch/spec.md"

# ── Layer 1: Static spec-sensitive patterns ──────────────────────────────
# These paths are always spec-relevant regardless of spec.md content.
# When adding a new source module, API route, or core component, add it here.
SPEC_SENSITIVE_PATTERNS=(
  # ── Core business logic ──
  "src/lib/nordic/"
  "src/lib/constants.ts"

  # ── Database ──
  "src/lib/db/schema.ts"
  "src/lib/db/nordic.ts"
  "src/lib/db/index.ts"
  "drizzle.config.ts"

  # ── API routes ──
  "src/app/api/"

  # ── LLM integration ──
  "src/lib/llm/"

  # ── UI components (spec-relevant) ──
  "src/app/fetch-button.tsx"
  "src/components/article/"
  "src/components/news/news-section.tsx"
  "src/app/layout.tsx"
  "src/app/page.tsx"
  "src/app/loading.tsx"
)

# ── Collect staged files ─────────────────────────────────────────────────
STAGED_FILES=$(git diff --cached --name-only --diff-filter=ACM 2>/dev/null || true)

if [ -z "$STAGED_FILES" ]; then
  exit 0
fi

# ── Detect spec-sensitive changes ────────────────────────────────────────
SENSITIVE_STAGED=false

# Layer 1: Static pattern matching
for pattern in "${SPEC_SENSITIVE_PATTERNS[@]}"; do
  if echo "$STAGED_FILES" | grep -q "^${pattern}"; then
    SENSITIVE_STAGED=true
    break
  fi
done

# Layer 2: Dynamic extraction from spec.md
# Parse all `src/...` and `tests/...` backtick references from spec.md
# and check if any staged file matches.
if [ "$SENSITIVE_STAGED" = false ] && [ -f "$SPEC_FILE" ]; then
  # Extract backtick-quoted paths starting with src/ or tests/
  SPEC_REFS=$(grep -oP '`((src|tests)/[^`]+)' "$SPEC_FILE" 2>/dev/null | sed 's/`//g' || true)
  if [ -n "$SPEC_REFS" ]; then
    while IFS= read -r ref; do
      if echo "$STAGED_FILES" | grep -q "^${ref}"; then
        SENSITIVE_STAGED=true
        break
      fi
    done <<< "$SPEC_REFS"
  fi
fi

if [ "$SENSITIVE_STAGED" = false ]; then
  exit 0
fi

# ── Check if spec.md is also staged ──────────────────────────────────────
if echo "$STAGED_FILES" | grep -q "^${SPEC_FILE}$"; then
  echo "[spec-check] ✓ spec.md is staged alongside spec-sensitive changes."
  exit 0
fi

# ── Warning ──────────────────────────────────────────────────────────────
echo ""
echo "┌─────────────────────────────────────────────────────────────┐"
echo "│  ⚠  spec.md 更新の確認が必要です                          │"
echo "│                                                             │"
echo "│  以下のファイルが staged されていますが、                  │"
echo "│  openspec/specs/news-watch/spec.md が含まれていません。    │"
echo "│                                                             │"

# Print matched sensitive files
ALL_PATTERNS=("${SPEC_SENSITIVE_PATTERNS[@]}")
if [ -f "$SPEC_FILE" ]; then
  SPEC_REFS=$(grep -oP '`((src|tests)/[^`]+)' "$SPEC_FILE" 2>/dev/null | sed 's/`//g' || true)
  while IFS= read -r ref; do
    ALL_PATTERNS+=("$ref")
  done <<< "$SPEC_REFS"
fi

# Deduplicate and print
MATCHED_FILES=$(echo "$STAGED_FILES" | grep -f <(printf "%s\n" "${ALL_PATTERNS[@]}" | sed 's/^/^/') || true)
if [ -n "$MATCHED_FILES" ]; then
  while IFS= read -r f; do
    echo "│    • $f"
  done <<< "$MATCHED_FILES"
fi

echo "│                                                             │"
echo "│  スキーマ・スコアリング・API の変更には spec.md の更新が   │"
echo "│  推奨されます。現状は warn のみで commit は阻止しません。   │"
echo "└─────────────────────────────────────────────────────────────┘"
echo ""

exit 0
