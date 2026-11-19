# Locales

Each `<locale>.json` file is a flat string-to-string map. English (`en.json`) is the source of truth: every key the UI ever uses lives there. Other locales are partial: any key missing from `<locale>.json` automatically falls back to English at runtime.

Languages today: English (`en`), Italian (`it`), Polish (`pl`), German (`de`), French (`fr`), Spanish (`es`) and Brazilian Portuguese (`pt`).

## Add a new language

1. Copy `en.json` to `<code>.json` where `<code>` is an ISO 639-1 code (`nl`, `cs`, `uk`, ...).
2. Translate values. You may leave keys you are unsure about untouched (still in English).
3. Register the new locale in `src/lib/i18n.ts`, the only place that lists languages:
   - Add the code to `LOCALES` (the order is the order of the language picker).
   - Add a `LOCALE_INFO` entry: the language's name in that language (shown in the picker, so no dictionary key is needed), the `Intl` tag used for dates, numbers, plural rules and sorting, and `dottedOrdinals: true` if day numbers are written "5." as in German and Polish.
   - Add the import and the `DICTS` entry. TypeScript reports a missing `LOCALE_INFO` or `DICTS` entry.

   Everything else follows from `LOCALES`: the `Locale` type, the settings validation, the language picker, the browser language detection (`Accept-Language`) and the `lang` attribute. The in-app release notes (`src/lib/changelog.ts`) need English only and fall back to it, so old entries do not need translating.
4. Run `npx vitest run src/lib/__tests__/i18n.test.ts`: it checks every `.json` file in this folder for missing keys, placeholders, plural forms and em dashes, and that every file is registered.
5. Open a PR. The CLA assistant will prompt you to sign on first contribution.

## Update an existing language

Just edit the file and open a PR. No code changes needed. Tip: run `npm run dev`, switch language in Settings, and watch the dev console: every fallback logs once with the missing key and target locale.

## Coverage

`localeCoverage(locale)` and `missingKeys(locale)` in `src/lib/i18n.ts` expose translation completeness programmatically. Useful if you want to surface a "70% translated, help out" banner.

## Style

- Keep punctuation consistent with English (period at the end of sentences, no period for short labels).
- Avoid em-dashes; use commas, periods, or colons.
- Match capitalization of the English source unless the target language has different conventions.
- Keep placeholders like `{name}` and `{count}` exactly as in English; the app fills them in.
- Address the user informally, like German "du": "tu" in French, "tú" in Spanish, "você" in Brazilian Portuguese. `i18n.test.ts` flags the formal forms (Sie, vous, usted, o senhor).
- Keep product terms consistent within a language. Card, board and column are: Italian card, bacheca, colonna; German Karte, Board, Spalte; Polish karta, tablica, kolumna; French carte, tableau, colonne; Spanish tarjeta, tablero, columna; Portuguese cartão, quadro, coluna.

## Counts and plural forms

Texts with a number come in plural forms, picked with `Intl.PluralRules` by `tn()` in `src/lib/i18n.ts`: `en.json` has `<key>_one` and `<key>_other`, and each language adds the forms it needs (Polish: `_one`, `_few`, `_many` and `_other`; Italian, German, French, Spanish and Portuguese: `_one` and `_other`). French and Brazilian Portuguese use `_one` for 0 as well as 1, so write it to read right for both ("0 commentaire"). French, Spanish and Portuguese also have a `many` form for millions; without a `_many` key `tn()` uses `_other`, which reads the same with digits. `src/lib/__tests__/i18n.test.ts` checks that every language has all the forms it uses for 0 to 199.

## Unused keys

`src/lib/__tests__/i18n-usage.test.ts` fails when a key in `en.json` is not referenced anywhere in `src`. Keys built at runtime (`error_<code>`, `audit_<action>`, plural forms) are covered by a documented allowlist in that test.
