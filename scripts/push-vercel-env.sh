#!/usr/bin/env bash
# Push values from .env.vercel-import to Vercel production+preview envs.
# Removes the existing (empty) entry first, then re-adds with the real
# value. Skips lines whose value is empty.
#
# Usage:  cd apps/web && bash ../../scripts/push-vercel-env.sh

set -euo pipefail

FILE="${1:-.env.vercel-import}"
if [[ ! -f "$FILE" ]]; then
  echo "Missing $FILE. Fill it in first." >&2
  exit 1
fi

ENVS=("production" "preview")

while IFS= read -r line || [[ -n "$line" ]]; do
  # Skip comments and blanks
  [[ "$line" =~ ^[[:space:]]*# ]] && continue
  [[ -z "${line// /}" ]] && continue
  # Must be KEY=VALUE
  [[ "$line" != *"="* ]] && continue

  key="${line%%=*}"
  val="${line#*=}"
  # Strip surrounding quotes
  val="${val%\"}"
  val="${val#\"}"

  if [[ -z "$val" ]]; then
    echo "skip  $key (empty)"
    continue
  fi

  for env in "${ENVS[@]}"; do
    # Remove existing (errors if not set — ignore)
    vercel env rm "$key" "$env" --yes >/dev/null 2>&1 || true
    # Add new value via stdin
    printf '%s' "$val" | vercel env add "$key" "$env" >/dev/null 2>&1
    echo "set   $key  ($env)"
  done
done < "$FILE"

echo "Done. Trigger a redeploy:  vercel --prod"
