#!/bin/bash
# check-api-parity.sh (kept at scripts/sync-api.sh so existing references hold)
#
# Legacy api/ is FROZEN. Fails when a NEW *.js endpoint appears under api/
# without a manifest row in api/PARITY.md.
#
# Usage: ./scripts/sync-api.sh   (exit 0 = frozen, exit 1 = drift)

set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
manifest="$repo_root/api/PARITY.md"

# Backticked api/ paths listed in the manifest table + support-files list.
allowed=$(sed -n 's/^[-*] `\(api\/[^`]*\)`.*/\1/p; s/^| `\(api\/[^`]*\)` |.*/\1/p' "$manifest" | sort -u)

fail=0
while IFS= read -r file; do
  rel="${file#$repo_root/}"
  if ! printf '%s\n' "$allowed" | grep -qxF "$rel"; then
    echo "DRIFT: $rel is a legacy api/ file with no api/PARITY.md row."
    fail=1
  fi
done < <(cd "$repo_root" && ls api/*.js api/discord/*.js api/collections/*.js 2>/dev/null | sort -u)

if [ "$fail" -ne 0 ]; then
  echo ""
  echo "Legacy api/ grew without manifest approval. Implement the endpoint in"
  echo "dashboard/src/pages/api/ instead, or add a PARITY.md row with reviewer sign-off."
  exit 1
fi

echo "api/ parity OK: no unmanifested legacy files."
