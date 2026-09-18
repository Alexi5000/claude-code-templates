#!/bin/bash
# check-versions.sh — root and cli-tool versions must match.
# The local package.json drifts from npm when published from CI (see CLAUDE.md).
set -euo pipefail

root=$(node -p "require('./package.json').version")
cli=$(node -p "require('./cli-tool/package.json').version")

if [ "$root" != "$cli" ]; then
  echo "version drift: root=$root cli-tool=$cli"
  exit 1
fi

echo "versions match: $root"
