#!/usr/bin/env bash
# PreToolUse guardrail (matcher: Read): block reads of secret-shaped files so their
# contents never enter the model's context, even indirectly (e.g. via a skill exploring
# the repo).
#
# TODO(team): add more patterns to the case block below as needed for your stack
# (e.g. *.key, id_rsa*, *.p12, secrets.yml, *.tfvars, service-account*.json).
set -euo pipefail

input="$(cat)"

extract_field() {
  local field="$1" nested="$2"
  if command -v jq >/dev/null 2>&1; then
    if [[ "$nested" == "nested" ]]; then
      printf '%s' "$input" | jq -r --arg f "$field" '.tool_input[$f] // empty' 2>/dev/null
    else
      printf '%s' "$input" | jq -r --arg f "$field" '.[$f] // empty' 2>/dev/null
    fi
  else
    printf '%s' "$input" \
      | grep -o "\"$field\"[[:space:]]*:[[:space:]]*\"[^\"]*\"" \
      | head -1 \
      | sed -E "s/^\"$field\"[[:space:]]*:[[:space:]]*\"//; s/\"\$//"
  fi
}

tool_name="$(extract_field tool_name top)"
file_path="$(extract_field file_path nested)"

if [[ "$tool_name" != "Read" ]]; then
  exit 0
fi

if [[ -z "$file_path" ]]; then
  exit 0
fi

basename_lc="$(basename "$file_path" | tr '[:upper:]' '[:lower:]')"

blocked_reason=""
case "$basename_lc" in
  .env|.env.*) blocked_reason="matches .env" ;;
  *.pem) blocked_reason="matches *.pem" ;;
  *credentials*) blocked_reason="matches *credentials*" ;;
  # TODO(team): add more case patterns here, e.g.:
  # *.key|id_rsa|id_rsa.*|*.p12|secrets.yml) blocked_reason="matches TODO(team) pattern" ;;
esac

if [[ -n "$blocked_reason" ]]; then
  echo "dp-agent: blocked read of '$file_path' — $blocked_reason, a secret-file pattern. It must not enter context." >&2
  exit 2
fi

exit 0
