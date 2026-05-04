# Locales

Each `<locale>.json` file is a flat string-to-string map. English (`en.json`) is the source of truth: every key the UI ever uses lives there. Other locales are partial — any key missing from `<locale>.json` automatically falls back to English at runtime.

## Add a new language

1. Copy `en.json` to `<code>.json` where `<code>` is an ISO 639-1 code (`de`, `fr`, `es`, `it`, `ua`, `cz`, ...).
2. Translate values. You may leave keys you are unsure about untouched, they will fall back to English.
3. Register the new locale in `src/lib/i18n.ts`:
   - Add the code to the `Locale` union.
   - Add the import + `DICTS` entry.
   - Add the option to the language switcher (`src/app/(app)/settings/SettingsForm.tsx`) with the matching dictionary keys (`langDe`, `langFr`, ...) added to `en.json` and your new file.
4. Open a PR. The CLA assistant will prompt you to sign on first contribution.

## Update an existing language

Just edit the file and open a PR. No code changes needed. Tip: run `npm run dev`, switch language in Settings, and watch the dev console — every fallback logs once with the missing key and target locale.

## Coverage

`localeCoverage(locale)` and `missingKeys(locale)` in `src/lib/i18n.ts` expose translation completeness programmatically. Useful if you want to surface a "70% translated, help out" banner.

## Style

- Keep punctuation consistent with English (period at the end of sentences, no period for short labels).
- Avoid em-dashes; use commas, periods, or colons.
- Match capitalization of the English source unless the target language has different conventions.
- Placeholders like `{name}` are not used yet. If you need string interpolation, open an issue first so we agree on the format.
