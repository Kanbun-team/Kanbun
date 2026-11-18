"use client";

import { useId, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Upload } from "lucide-react";
import { t, type Locale } from "@/lib/i18n";
import { buttonClass } from "@/components/ui/button";
import { importErrorMessage, postImport, type ImportFailure } from "./import-errors";

interface ImportSuccess {
  ok: true;
  source: "trello" | "kanbun";
  boards: { id: string; name: string }[];
  stats: { columns: number; cards: number; comments: number; checklistItems: number; tags: number };
  skipped: { lists: number; cards: number };
  unmatchedUsers: string[];
}

const fill = (s: string, values: Record<string, string | number>) =>
  s.replace(/\{(\w+)\}/g, (m, k: string) => (k in values ? String(values[k]) : m));

// Upload a Trello or Kanbun JSON file; the server tells the formats apart.
export default function ImportBoardForm({ locale, maxBytes }: { locale: Locale; maxBytes: number }) {
  const router = useRouter();
  const inputId = useId();
  const hintId = useId();
  const [file, setFile] = useState<File | null>(null);
  const [result, setResult] = useState<ImportSuccess | ImportFailure | null>(null);
  const [pending, startTransition] = useTransition();
  const maxMb = Math.round(maxBytes / 1024 / 1024);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!file) return;
    if (file.size > maxBytes) {
      setResult({ ok: false, error: "tooLarge", maxMb });
      return;
    }
    startTransition(async () => {
      const res = await postImport<ImportSuccess>("/api/import", file, "application/json");
      setResult(res);
      if (res.ok) router.refresh();
    });
  }

  return (
    <div className="space-y-4">
      <form onSubmit={submit} className="bg-surface border border-line rounded-panel p-4 space-y-3" aria-busy={pending || undefined}>
        <label htmlFor={inputId} className="block text-sm font-medium">
          {t("importFileLabel", locale)}
        </label>
        <input
          id={inputId}
          type="file"
          accept=".json,application/json"
          aria-describedby={hintId}
          onChange={(e) => {
            setFile(e.target.files?.[0] ?? null);
            setResult(null);
          }}
          className="block w-full text-sm"
        />
        <p id={hintId} className="text-xs text-ink-muted">
          {fill(t("importFileHint", locale), { mb: maxMb })}
        </p>
        <button type="submit" disabled={!file || pending} className={buttonClass("primary", "md", "disabled:opacity-60")}>
          {pending ? (
            <span className="w-3.5 h-3.5 rounded-full border-2 border-accent-fg/70 border-t-transparent animate-spin" aria-hidden />
          ) : (
            <Upload size={16} aria-hidden />
          )}
          {pending ? t("importRunning", locale) : t("importSubmit", locale)}
        </button>
      </form>

      <div aria-live="polite">
        {result && !result.ok && (
          <div role="alert" className="border border-danger/40 bg-danger/5 rounded-panel p-4 space-y-2">
            <p className="font-medium text-danger">{importErrorMessage(result, locale)}</p>
            {result.issues && result.issues.length > 0 && (
              <ul className="text-sm text-ink-muted list-disc pl-5 break-words">
                {result.issues.map((issue) => (
                  <li key={issue}>{issue}</li>
                ))}
              </ul>
            )}
          </div>
        )}
        {result && result.ok && (
          <div className="border border-success/40 bg-success/5 rounded-panel p-4 space-y-3">
            <p className="font-medium">
              {fill(t(result.source === "trello" ? "importDoneTrello" : "importDoneKanbun", locale), {
                boards: result.boards.length,
              })}
            </p>
            <p className="text-sm text-ink-muted">{fill(t("importSummary", locale), result.stats)}</p>
            {(result.skipped.lists > 0 || result.skipped.cards > 0) && (
              <p className="text-sm text-ink-muted">{fill(t("importSkipped", locale), result.skipped)}</p>
            )}
            {result.unmatchedUsers.length > 0 && (
              <p className="text-sm text-ink-muted">
                {fill(t("importUnmatchedUsers", locale), { names: result.unmatchedUsers.join(", ") })}
              </p>
            )}
            <ul className="flex flex-wrap gap-2">
              {result.boards.map((b) => (
                <li key={b.id}>
                  <Link href={`/tasks/${b.id}`} className={buttonClass("primary", "md")}>
                    {fill(t("importOpenBoard", locale), { name: b.name })}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}
