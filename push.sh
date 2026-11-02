#!/usr/bin/env bash
# Push research to Research Hub.
#   ./push.sh <project-slug> <file|-> ["Title"] ["Summary"]
#
#   ./push.sh market-sizing report.pdf "Q3 market sizing"
#   ./push.sh market-sizing findings.md
#   pbpaste | ./push.sh market-sizing - "Notes from Claude"      # macOS clipboard
#   xclip -o | ./push.sh market-sizing - "Notes from ChatGPT"     # Linux clipboard
#
# Needs: RH_URL (e.g. https://research.example.com) and RH_TOKEN (create under "Push from LLM").
# Optional: RH_ALLOWED="a@x.com,b@x.com" to restrict the report to those project members.
set -euo pipefail

: "${RH_URL:?Set RH_URL to your Research Hub address}"
: "${RH_TOKEN:?Set RH_TOKEN to an API token}"
project="${1:?Usage: push.sh <project-slug> <file|-> [title] [summary]}"
src="${2:?Usage: push.sh <project-slug> <file|-> [title] [summary]}"
title="${3:-}"
summary="${4:-}"

args=(-sS --fail-with-body -X POST "${RH_URL%/}/api/v1/reports" -H "Authorization: Bearer ${RH_TOKEN}" -F "project=${project}")
[ -n "$title" ] && args+=(-F "title=${title}")
[ -n "$summary" ] && args+=(-F "summary=${summary}")
if [ -n "${RH_ALLOWED:-}" ]; then
  IFS=',' read -ra emails <<< "$RH_ALLOWED"
  for e in "${emails[@]}"; do args+=(-F "allowed=${e}"); done
fi

if [ "$src" = "-" ]; then
  tmp="$(mktemp)"; trap 'rm -f "$tmp"' EXIT
  cat > "$tmp"
  if head -c 200 "$tmp" | grep -qiE '<!doctype html|<html'; then fmt=html; else fmt=markdown; fi
  args+=(-F "format=${fmt}" -F "content=<${tmp}")
else
  [ -f "$src" ] || { echo "No such file: $src" >&2; exit 1; }
  args+=(-F "file=@${src}")
fi

resp="$(curl "${args[@]}")" || { echo "$resp" >&2; exit 1; }
url="$(printf '%s' "$resp" | sed -n 's/.*"url": *"\([^"]*\)".*/\1/p' | tail -1)"
echo "Published: ${url:-$resp}"
