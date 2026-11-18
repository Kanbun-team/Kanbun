import en from "@/locales/en.json";
import { t, type DictKey, type Locale } from "@/lib/i18n";
import { errorMessage } from "@/components/ui/UiProvider";

/** Error body of the import route handlers. */
export interface ImportFailure {
  ok: false;
  error: string;
  issues?: string[];
  maxMb?: number;
  max?: number;
}

/** Translated message for an import error code (falls back to the generic error texts). */
export function importErrorMessage(failure: Pick<ImportFailure, "error" | "maxMb" | "max">, locale: Locale): string {
  const key = `importError_${failure.error}`;
  const text = key in en ? t(key as DictKey, locale) : errorMessage(failure.error, locale);
  return text.replace("{mb}", String(failure.maxMb ?? "")).replace("{max}", String(failure.max ?? ""));
}

/** POSTs to an import route and returns its JSON, turning network failures into an error body. */
export async function postImport<T>(url: string, body: BodyInit, contentType: string): Promise<T | ImportFailure> {
  try {
    const res = await fetch(url, { method: "POST", body, headers: { "Content-Type": contentType } });
    const json = await res.json().catch(() => null);
    if (json && typeof json === "object" && "ok" in json) return json as T | ImportFailure;
    return { ok: false, error: res.status === 413 ? "tooLarge" : "unknown" };
  } catch {
    return { ok: false, error: "network" };
  }
}
