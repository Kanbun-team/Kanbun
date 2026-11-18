"use client";

import { useId, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Upload } from "lucide-react";
import { t, type DictKey, type Locale } from "@/lib/i18n";
import { priorityLabel } from "@/lib/labels";
import { detectDelimiter, parseCsv, type Delimiter } from "@/lib/csv";
import {
  CSV_FIELDS,
  guessMapping,
  planCsvImport,
  type CsvField,
  type CsvIssue,
  type CsvMapping,
} from "@/lib/transfer/csv-import";
import { buttonClass } from "@/components/ui/button";
import { useUi } from "@/components/ui/UiProvider";
import { importErrorMessage, postImport, type ImportFailure } from "./import-errors";

interface Props {
  boardId: string;
  columns: string[];
  tags: string[];
  members: string[];
  maxBytes: number;
  locale: Locale;
}

interface Loaded {
  name: string;
  text: string;
  delimiter: Delimiter;
  mapping: CsvMapping;
}

const FIELD_KEYS: Record<CsvField, DictKey> = {
  title: "csvFieldTitle",
  description: "csvFieldDescription",
  column: "csvFieldColumn",
  priority: "csvFieldPriority",
  deadline: "csvFieldDeadline",
  tags: "csvFieldTags",
  assignees: "csvFieldAssignees",
};

const PREVIEW_ROWS = 5;
const fill = (s: string, values: Record<string, string | number>) =>
  s.replace(/\{(\w+)\}/g, (m, k: string) => (k in values ? String(values[k]) : m));

function issueText(issue: CsvIssue, locale: Locale): string {
  const key = ({
    missingTitle: "csvIssueMissingTitle",
    badPriority: "csvIssueBadPriority",
    badDeadline: "csvIssueBadDeadline",
    unknownUser: "csvIssueUnknownUser",
  } as const)[issue.kind];
  return fill(t(key, locale), { line: issue.line, value: "value" in issue ? issue.value : "" });
}

// CSV import with a preview: pick a file, check how its headers map onto card
// fields, see the first rows and every problem, then import.
export default function CsvImport({ boardId, columns, tags, members, maxBytes, locale }: Props) {
  const ui = useUi();
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const fileId = useId();
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [error, setError] = useState<ImportFailure | null>(null);
  const [pending, startTransition] = useTransition();
  const maxMb = Math.round(maxBytes / 1024 / 1024);

  async function onFile(file: File | undefined) {
    setError(null);
    setLoaded(null);
    if (!file) return;
    if (file.size > maxBytes) {
      setError({ ok: false, error: "tooLarge", maxMb });
      return;
    }
    const text = await file.text();
    const delimiter = detectDelimiter(text.replace(/^﻿/, ""));
    const [headers = []] = parseCsv(text, delimiter);
    if (headers.length === 0) {
      setError({ ok: false, error: "empty" });
      return;
    }
    setLoaded({ name: file.name, text, delimiter, mapping: guessMapping(headers) });
  }

  const rows = loaded ? parseCsv(loaded.text, loaded.delimiter) : [];
  const headers = rows[0] ?? [];
  const dataRows = rows.slice(1);
  const plan = loaded ? planCsvImport(dataRows, loaded.mapping, { columns, tags, members }) : null;
  const problems = plan ? [...plan.errors, ...plan.warnings].sort((a, b) => a.line - b.line) : [];

  function reset() {
    setLoaded(null);
    setError(null);
    if (fileRef.current) fileRef.current.value = "";
  }

  function runImport() {
    if (!loaded) return;
    startTransition(async () => {
      const res = await postImport<{ ok: true; cards: number }>(
        `/api/import/csv?boardId=${encodeURIComponent(boardId)}`,
        JSON.stringify({ csv: loaded.text, delimiter: loaded.delimiter, mapping: loaded.mapping }),
        "application/json"
      );
      if (!res.ok) {
        setError(res);
        return;
      }
      ui.toast({ message: fill(t("csvImported", locale), { count: res.cards }) });
      reset();
      router.refresh();
    });
  }

  const th = "px-2 py-1.5 font-medium text-left whitespace-nowrap";
  const td = "px-2 py-1.5 align-top";

  return (
    <div className="space-y-3">
      <div className="space-y-1">
        <label htmlFor={fileId} className="block text-sm text-ink-muted">
          {t("csvFileLabel", locale)}
        </label>
        <input
          ref={fileRef}
          id={fileId}
          type="file"
          accept=".csv,text/csv,text/plain"
          onChange={(e) => void onFile(e.target.files?.[0])}
          className="block w-full text-sm"
        />
        <p className="text-xs text-ink-muted">{fill(t("csvFileHint", locale), { mb: maxMb })}</p>
      </div>

      {error && (
        <p role="alert" className="text-sm text-danger font-medium">
          {importErrorMessage(error, locale)}
        </p>
      )}

      {loaded && plan && (
        <div className="space-y-4 border-t border-line pt-3">
          <fieldset className="space-y-2">
            <legend className="text-sm font-semibold">{t("csvMapping", locale)}</legend>
            <div className="grid gap-2 sm:grid-cols-2">
              <label className="block">
                <span className="text-sm text-ink-muted">{t("csvDelimiter", locale)}</span>
                <select
                  value={loaded.delimiter}
                  onChange={(e) => {
                    const delimiter = e.target.value as Delimiter;
                    const [h = []] = parseCsv(loaded.text, delimiter);
                    setLoaded({ ...loaded, delimiter, mapping: guessMapping(h) });
                  }}
                >
                  <option value=",">{t("csvDelimiterComma", locale)}</option>
                  <option value=";">{t("csvDelimiterSemicolon", locale)}</option>
                  <option value={"\t"}>{t("csvDelimiterTab", locale)}</option>
                </select>
              </label>
              {CSV_FIELDS.map((field) => (
                <label key={field} className="block">
                  <span className="text-sm text-ink-muted">
                    {t(FIELD_KEYS[field], locale)}
                    {field === "title" && ` (${t("csvRequired", locale)})`}
                  </span>
                  <select
                    value={loaded.mapping[field] ?? ""}
                    onChange={(e) =>
                      setLoaded({
                        ...loaded,
                        mapping: { ...loaded.mapping, [field]: e.target.value === "" ? null : Number(e.target.value) },
                      })
                    }
                  >
                    <option value="">{t("csvNotImported", locale)}</option>
                    {headers.map((h, i) => (
                      <option key={i} value={i}>
                        {h || fill(t("csvColumnN", locale), { n: i + 1 })}
                      </option>
                    ))}
                  </select>
                </label>
              ))}
            </div>
          </fieldset>

          <section aria-labelledby={`${fileId}-preview`} className="space-y-2">
            <h3 id={`${fileId}-preview`} className="text-sm font-semibold">
              {t("csvPreview", locale)}
            </h3>
            <p className="text-sm" aria-live="polite">
              {fill(t("csvPlanSummary", locale), {
                cards: plan.cards.length,
                skipped: plan.errors.length,
                warnings: plan.warnings.length,
              })}
            </p>
            {plan.tooManyRows && <p className="text-sm text-danger">{importErrorMessage({ error: "tooManyRows", max: 5000 }, locale)}</p>}
            {(plan.newColumns.length > 0 || plan.newTags.length > 0) && (
              <p className="text-sm text-ink-muted">
                {plan.newColumns.length > 0 && fill(t("csvNewColumns", locale), { names: plan.newColumns.join(", ") })}{" "}
                {plan.newTags.length > 0 && fill(t("csvNewTags", locale), { names: plan.newTags.join(", ") })}
              </p>
            )}
            {plan.cards.length > 0 && (
              <div className="overflow-x-auto border border-line rounded-card">
                <table className="w-full text-sm">
                  <caption className="sr-only">{t("csvPreview", locale)}</caption>
                  <thead className="bg-paper text-ink-muted">
                    <tr>
                      <th scope="col" className={th}>{t("csvLine", locale)}</th>
                      <th scope="col" className={th}>{t("csvFieldTitle", locale)}</th>
                      <th scope="col" className={th}>{t("csvFieldColumn", locale)}</th>
                      <th scope="col" className={th}>{t("csvFieldPriority", locale)}</th>
                      <th scope="col" className={th}>{t("csvFieldDeadline", locale)}</th>
                      <th scope="col" className={th}>{t("csvFieldTags", locale)}</th>
                      <th scope="col" className={th}>{t("csvFieldAssignees", locale)}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {plan.cards.slice(0, PREVIEW_ROWS).map((c) => (
                      <tr key={c.line}>
                        <td className={`${td} tabular-nums text-ink-muted`}>{c.line}</td>
                        <td className={`${td} min-w-40`}>{c.title}</td>
                        <td className={td}>{c.column}</td>
                        <td className={td}>{priorityLabel(c.priority, locale)}</td>
                        <td className={`${td} tabular-nums whitespace-nowrap`}>{c.deadline ?? ""}</td>
                        <td className={td}>{c.tags.join(", ")}</td>
                        <td className={td}>{c.assignees.join(", ")}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {problems.length > 0 && (
              <details className="text-sm" open={problems.length <= 5}>
                <summary className="cursor-pointer min-h-6">
                  {fill(t("csvProblems", locale), { count: problems.length })}
                </summary>
                <ul className="mt-1 list-disc pl-5 space-y-0.5">
                  {problems.slice(0, 50).map((p, i) => (
                    <li key={i} className={plan.errors.includes(p) ? "text-danger" : "text-ink-muted"}>
                      {issueText(p, locale)}
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </section>

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={runImport}
              disabled={pending || plan.cards.length === 0 || plan.tooManyRows || loaded.mapping.title === null}
              className={buttonClass("primary", "md", "disabled:opacity-60")}
            >
              <Upload size={16} aria-hidden />
              {fill(t("csvImportCards", locale), { count: plan.cards.length })}
            </button>
            <button type="button" onClick={reset} className={buttonClass("ghost", "md")}>
              {t("cancel", locale)}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
