#!/usr/bin/env bash
# PreToolUse guardrail (matcher: Edit|Write): block edits/writes to a test file that
# already exists on disk. Creating a NEW test file is always allowed — this only stops
# modification of a test that's already there, so a coding agent can't quietly change a
# test's expectations to make a failing implementation pass.
#
# TODO(team): tune TEST_FILE_REGEX below if it doesn't match your test conventions.
set -euo pipefail

TEST_FILE_REGEX='(^|/)(tests?|__tests__|spec)/|\.(test|spec)\.[a-zA-Z0-9]+$|(^|/)(test_[^/]+|[^/]+_test)\.[a-zA-Z0-9]+$|(^|/)[^/]+(Test|Spec)\.[a-zA-Z0-9]+$'

input="$(cat)"

# Extract a top-level or tool_input.<field> string value. Prefers jq when available;
# falls back to a grep/sed pass that's good enough for flat string fields like paths.
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

if [[ "$tool_name" != "Edit" && "$tool_name" != "Write" ]]; then
  exit 0
fi

if [[ -z "$file_path" ]]; then
  exit 0
fi

if [[ ! -e "$file_path" ]]; then
  exit 0 # new file — always allowed
fi

if [[ "$file_path" =~ $TEST_FILE_REGEX ]]; then
  echo "dp-agent: blocked — '$file_path' is an existing test file; modifying it is not allowed by policy. Add a new test instead, or have the developer edit it directly." >&2
  exit 2
fi

exit 0
