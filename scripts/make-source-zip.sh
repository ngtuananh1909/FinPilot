#!/usr/bin/env bash
# Builds the contest source ZIP from files tracked by git (so .gitignore'd secrets and build
# output are never included). Default: list the files and run safety checks only.
#   scripts/make-source-zip.sh          # dry run
#   scripts/make-source-zip.sh --write  # writes finpilot-source.zip (requires at least one commit)
set -euo pipefail
cd "$(dirname "$0")/.."

if ! git rev-parse --verify HEAD >/dev/null 2>&1; then
  echo "BLOCKED: no commit yet. Commit the release first (no push needed)."
  exit 3
fi

files=$(git ls-files)
if echo "$files" | grep -E '(^|/)\.env($|\.)' | grep -v '\.env\.example$' >/dev/null; then
  echo "REFUSING: an env file is tracked by git." >&2
  exit 1
fi
echo "$files" | wc -l | xargs echo "files tracked:"

if [[ "${1:-}" == "--write" ]]; then
  git archive --format=zip --output=finpilot-source.zip HEAD
  echo "wrote finpilot-source.zip"
else
  echo "dry run: pass --write to create finpilot-source.zip"
fi
