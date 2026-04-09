#!/usr/bin/env bash
# Bounded NDJSON extract from docker compose backend logs (for humans & coding agents).
# Requires: docker compose, jq
# Env: SERVICE (default backend), REQUEST_ID, LEVEL, LIMIT, OUT (file path or empty=stdout)
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

SERVICE="${SERVICE:-backend}"
LIMIT="${LIMIT:-200}"
REQUEST_ID="${REQUEST_ID:-}"
LEVEL="${LEVEL:-}"
OUT="${OUT:-}"

die() {
  echo "$1" >&2
  exit 1
}

require_command() {
  local command_name="$1"
  command -v "$command_name" >/dev/null 2>&1 || die "Missing required command: $command_name"
}

validate_limit() {
  [[ "$LIMIT" =~ ^[0-9]+$ ]] || die "LIMIT must be a positive integer"
  (( LIMIT > 0 )) || die "LIMIT must be greater than 0"
}

strip_prefix() {
  # "backend-1  | {...}" -> "{...}"
  sed -E 's/^[^|]*\|[[:space:]]//'
}

read_stream() {
  docker compose logs "$SERVICE" --no-color | strip_prefix
}

filter_jq() {
  jq -c -R --arg request_id_filter "$REQUEST_ID" --arg level_filter "$LEVEL" '
    (try fromjson catch empty)
    | objects
    | select(($request_id_filter == "") or (.request_id == $request_id_filter))
    | select(($level_filter == "") or (.level == $level_filter))
  '
}

limit_output() {
  tail -n "$LIMIT"
}

require_command docker
require_command jq
validate_limit

docker compose config --services | grep -Fxq "$SERVICE" || die "Unknown docker compose service: $SERVICE"

if [[ -n "$OUT" ]]; then
  mkdir -p "$(dirname "$OUT")"
  read_stream | filter_jq | limit_output >"$OUT"
  echo "Wrote $(wc -l <"$OUT" | tr -d " ") lines to $OUT"
  LATEST="${ROOT}/logs/agent-latest.ndjson"
  mkdir -p "$(dirname "$LATEST")"
  ABS_OUT="$(cd "$(dirname "$OUT")" && pwd)/$(basename "$OUT")"
  ln -sf "$ABS_OUT" "$LATEST"
  echo "Symlink $LATEST -> $ABS_OUT"
else
  read_stream | filter_jq | limit_output
fi
