"use client";

import { useId, useState } from "react";
import { Check, Copy } from "lucide-react";
import { t, type Locale } from "@/lib/i18n";
import { buttonClass } from "./button";

// A secret shown once (a new API token, a webhook signing secret): read-only
// field, focused and selected on mount, with copy and dismiss buttons.
export default function SecretReveal({
  label,
  value,
  locale,
  onDone,
}: {
  label: string;
  value: string;
  locale: Locale;
  onDone: () => void;
}) {
  const id = useId();
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
    } catch {
      // Clipboard blocked (insecure context): the field is selected for a manual copy.
      (document.getElementById(id) as HTMLInputElement | null)?.select();
    }
  }

  return (
    <div className="rounded-control border border-accent/50 bg-accent-soft p-3 space-y-2">
      <label htmlFor={id} className="block text-sm font-medium">
        {label}
      </label>
      <p id={`${id}-hint`} className="text-sm text-ink-muted">
        {t("apiTokenShownOnce", locale)}
      </p>
      <div className="flex flex-wrap gap-2">
        <input
          id={id}
          readOnly
          value={value}
          aria-describedby={`${id}-hint`}
          autoFocus
          onFocus={(e) => e.currentTarget.select()}
          className="font-mono text-sm flex-1 min-w-0"
          spellCheck={false}
        />
        <button type="button" onClick={copy} className={buttonClass("secondary", "md", "h-auto")}>
          {copied ? <Check size={16} aria-hidden /> : <Copy size={16} aria-hidden />}
          {copied ? t("copied", locale) : t("copy", locale)}
        </button>
        <button type="button" onClick={onDone} className={buttonClass("primary", "md", "h-auto")}>
          {t("done", locale)}
        </button>
      </div>
      <span className="sr-only" aria-live="polite">
        {copied ? t("copied", locale) : ""}
      </span>
    </div>
  );
}
