#!/usr/bin/env bash
# Seed labels + translation issues. Idempotent: re-running is safe.
# Usage: ./scripts/seed-translation-issues.sh

set -euo pipefail

if ! command -v gh >/dev/null 2>&1; then
  echo "gh CLI not installed. See https://cli.github.com/"
  exit 1
fi

if ! gh auth status >/dev/null 2>&1; then
  echo "Not logged in. Run: gh auth login"
  exit 1
fi

retry() {
  local n=0 max=4 delay=2
  until "$@"; do
    n=$((n + 1))
    if [ "$n" -ge "$max" ]; then
      return 1
    fi
    sleep "$delay"
    delay=$((delay * 2))
  done
}

label() {
  local name="$1" color="$2" desc="$3"
  if retry gh label create "$name" --color "$color" --description "$desc" >/dev/null 2>&1; then
    echo "  created: $name"
  elif retry gh label edit "$name" --color "$color" --description "$desc" >/dev/null 2>&1; then
    echo "  updated: $name"
  else
    echo "  skipped: $name (gh failed; check 'gh label list')"
  fi
}

echo "Creating labels..."
# Auto-labeler workflow needs these
label "feat"             "16a34a" "New feature"
label "fix"              "dc2626" "Bug fix"
label "docs"             "0ea5e9" "Documentation"
label "chore"            "64748b" "Maintenance / housekeeping"
label "refactor"         "a855f7" "Refactor (no behavior change)"
label "perf"             "f59e0b" "Performance"
label "test"             "84cc16" "Tests"
label "ci"               "475569" "CI / build"
label "breaking-change"  "991b1b" "Breaking change"
# Community
label "i18n"             "8b5cf6" "Localization / translations"
label "good first issue" "7057ff" "Good for newcomers"
label "help wanted"      "008672" "Extra attention is needed"
label "ignore-for-release" "cbd5e1" "Do not include in release notes"

issue_exists() {
  local title="$1"
  retry gh issue list --search "$title in:title" --state all --json title --jq '.[].title' 2>/dev/null \
    | grep -Fxq "$title"
}

issue() {
  local code="$1" name="$2"
  local title="i18n: add ${name} (${code})"
  if issue_exists "$title"; then
    echo "  exists: $title"
    return 0
  fi
  local body="Add a ${name} translation by creating \`src/locales/${code}.json\` based on \`en.json\`.

Steps in [src/locales/README.md](../blob/main/src/locales/README.md). Short version:

1. Copy \`src/locales/en.json\` to \`src/locales/${code}.json\`.
2. Translate the values. Skip any key you are unsure about; missing keys fall back to English automatically.
3. Register the locale in \`src/lib/i18n.ts\`:
   - Extend the \`Locale\` union with \`\"${code}\"\`.
   - Import the JSON and add it to \`DICTS\`.
   - Add a corresponding \`langXX\` key to both \`en.json\` and \`${code}.json\`.
4. Add the language switcher option in \`src/app/(app)/settings/SettingsForm.tsx\`.
5. Open a PR. CLA assistant will guide you through signing the CLA on first contribution.

Partial translations are welcome. You do not need to translate every key in one PR."
  if retry gh issue create \
    --title "$title" \
    --label "i18n,good first issue,help wanted" \
    --body "$body" >/dev/null 2>&1; then
    echo "  created: $title"
  else
    echo "  skipped: $title (gh failed after retries; re-run later)"
  fi
}

echo
echo "Creating translation issues..."
issue "de"  "German"
issue "fr"  "French"
issue "es"  "Spanish"
issue "it"  "Italian"
issue "uk"  "Ukrainian"
issue "cs"  "Czech"
issue "pt"  "Portuguese"
issue "nl"  "Dutch"

echo
echo "Done."
