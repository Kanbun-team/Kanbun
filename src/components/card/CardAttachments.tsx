"use client";

import { useId, useRef, useState, useTransition, type DragEvent } from "react";
import { useRouter } from "next/navigation";
import { Download, FileText, Paperclip, Trash2 } from "lucide-react";
import { useUi, errorMessage } from "@/components/ui/UiProvider";
import { buttonClass, iconButtonClass } from "@/components/ui/button";
import RelativeTime from "@/components/ui/RelativeTime";
import { cn } from "@/lib/utils";
import { intlLocale, t, type DictKey, type Locale } from "@/lib/i18n";
import { formatBytes, isInlineImage } from "@/lib/attachments";
import { deleteAttachmentAction } from "@/server/attachment-actions";

// Card attachments: drop files on the section or use "Add files". Each file
// uploads on its own request (XMLHttpRequest, for progress) to
// /api/attachments. Images show as a thumbnail grid, other files as rows.

export interface AttachmentItem {
  id: string;
  fileName: string;
  mimeType: string;
  size: number;
  width: number | null;
  height: number | null;
  createdAt: string;
  uploaderName: string | null;
  canDelete: boolean;
}

interface Upload {
  key: number;
  name: string;
  /** 0 to 1. */
  progress: number;
}

type UploadResult = { ok: true } | { ok: false; error: string };

function upload(cardId: string, file: File, onProgress: (p: number) => void): Promise<UploadResult> {
  return new Promise((resolve) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `/api/attachments?cardId=${encodeURIComponent(cardId)}`);
    xhr.responseType = "json";
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(e.loaded / e.total);
    };
    xhr.onload = () => {
      const body = xhr.response as { ok?: boolean; error?: string } | null;
      if (xhr.status >= 200 && xhr.status < 300 && body?.ok) resolve({ ok: true });
      else resolve({ ok: false, error: body?.error ?? (xhr.status === 413 ? "tooLarge" : "unknown") });
    };
    xhr.onerror = () => resolve({ ok: false, error: "unknown" });
    const fd = new FormData();
    fd.set("file", file);
    xhr.send(fd);
  });
}

export default function CardAttachments({
  cardId,
  attachments,
  maxBytes,
  locale,
}: {
  cardId: string;
  attachments: AttachmentItem[];
  maxBytes: number;
  locale: Locale;
}) {
  const ui = useUi();
  const router = useRouter();
  const headingId = useId();
  const hintId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const nextKey = useRef(0);
  const [uploads, setUploads] = useState<Upload[]>([]);
  const [dragging, setDragging] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [, startTransition] = useTransition();
  const nf = intlLocale(locale);
  const maxText = formatBytes(maxBytes, nf);

  const images = attachments.filter((a) => isInlineImage(a.mimeType));
  const files = attachments.filter((a) => !isInlineImage(a.mimeType));

  async function addFiles(list: FileList | File[]) {
    const picked = [...list];
    if (picked.length === 0) return;
    for (const file of picked) {
      const fill = (key: DictKey) => t(key, locale).replace("{name}", file.name).replace("{max}", maxText);
      if (file.size === 0) {
        ui.toast({ message: fill("attachmentEmptyFile"), tone: "error" });
        continue;
      }
      if (file.size > maxBytes) {
        ui.toast({ message: fill("attachmentTooLarge"), tone: "error" });
        continue;
      }
      nextKey.current += 1;
      const key = nextKey.current;
      setUploads((u) => [...u, { key, name: file.name, progress: 0 }]);
      const result = await upload(cardId, file, (progress) =>
        setUploads((u) => u.map((x) => (x.key === key ? { ...x, progress } : x)))
      );
      setUploads((u) => u.filter((x) => x.key !== key));
      if (result.ok) {
        ui.toast({ message: t("attachmentUploaded", locale).replace("{name}", file.name) });
      } else if (result.error === "tooLarge") {
        ui.toast({ message: fill("attachmentTooLarge"), tone: "error" });
      } else if (result.error === "empty") {
        ui.toast({ message: fill("attachmentEmptyFile"), tone: "error" });
      } else if (["unauthorized", "forbidden", "notFound"].includes(result.error)) {
        ui.toast({ message: errorMessage(result.error, locale), tone: "error" });
      } else {
        ui.toast({ message: fill("attachmentUploadFailed"), tone: "error" });
      }
      if (result.ok) router.refresh();
    }
  }

  async function remove(a: AttachmentItem) {
    const ok = await ui.confirm({
      title: t("attachmentDeleteTitle", locale),
      body: t("attachmentDeleteBody", locale).replace("{name}", a.fileName),
      confirmLabel: t("delete", locale),
      danger: true,
    });
    if (!ok) return;
    setDeleting(a.id);
    startTransition(async () => {
      const fd = new FormData();
      fd.set("attachmentId", a.id);
      const result = ui.report(await deleteAttachmentAction(fd));
      if (result.ok) ui.toast({ message: t("attachmentDeleted", locale) });
      setDeleting(null);
      router.refresh();
    });
  }

  function onDrop(e: DragEvent) {
    e.preventDefault();
    setDragging(false);
    if (e.dataTransfer.files.length) void addFiles(e.dataTransfer.files);
  }

  const hasFiles = (e: DragEvent) => [...e.dataTransfer.types].includes("Files");

  return (
    <section
      aria-labelledby={headingId}
      onDragEnter={(e) => hasFiles(e) && setDragging(true)}
      onDragOver={(e) => {
        if (!hasFiles(e)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "copy";
        if (!dragging) setDragging(true);
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragging(false);
      }}
      onDrop={onDrop}
      className={cn(
        "relative rounded-panel -m-2 p-2 transition-colors duration-[120ms]",
        dragging && "bg-accent-soft outline-dashed outline-2 outline-accent"
      )}
    >
      <div className="flex items-center justify-between gap-2 mb-2">
        <h2 id={headingId} className="text-md font-semibold flex items-center gap-2">
          {t("cardAttachments", locale)}
          {attachments.length > 0 && (
            <span className="text-sm font-normal text-ink-muted tabular-nums">{attachments.length}</span>
          )}
        </h2>
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          aria-describedby={hintId}
          className={buttonClass("secondary", "sm")}
        >
          <Paperclip size={14} aria-hidden />
          {t("attachmentsAdd", locale)}
        </button>
        <input
          ref={inputRef}
          type="file"
          multiple
          hidden
          aria-hidden
          tabIndex={-1}
          data-testid="attachment-input"
          onChange={(e) => {
            const list = e.currentTarget.files;
            if (list) void addFiles([...list]);
            e.currentTarget.value = "";
          }}
        />
      </div>

      <p id={hintId} className="text-sm text-ink-muted mb-3">
        {dragging ? t("attachmentsDropActive", locale) : t("attachmentsHint", locale).replace("{max}", maxText)}
      </p>

      {uploads.length > 0 && (
        <ul className="space-y-2 mb-3">
          {uploads.map((u) => {
            const label = t("attachmentUploading", locale).replace("{name}", u.name);
            return (
              <li key={u.key} className="text-sm">
                <span className="block truncate text-ink-muted">{label}</span>
                <div
                  role="progressbar"
                  aria-label={label}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={Math.round(u.progress * 100)}
                  className="mt-1 h-1.5 rounded-full bg-ink/10 overflow-hidden"
                >
                  <div className="h-full bg-accent transition-[width]" style={{ width: `${Math.round(u.progress * 100)}%` }} />
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {attachments.length === 0 && uploads.length === 0 && (
        <p className="text-sm text-ink-muted">{t("attachmentsEmpty", locale)}</p>
      )}

      {images.length > 0 && (
        <ul aria-label={t("attachmentImages", locale)} className="grid grid-cols-2 sm:grid-cols-3 gap-2 mb-3">
          {images.map((a) => (
            <li
              key={a.id}
              className={cn(
                "group relative rounded-card border border-line bg-surface overflow-hidden",
                deleting === a.id && "opacity-50"
              )}
            >
              <a
                href={`/api/attachments/${a.id}`}
                target="_blank"
                rel="noopener"
                aria-label={t("attachmentOpen", locale).replace("{name}", a.fileName)}
                className="block aspect-[4/3] bg-paper outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-inset"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={`/api/attachments/${a.id}`}
                  alt={a.fileName}
                  width={a.width ?? undefined}
                  height={a.height ?? undefined}
                  loading="lazy"
                  decoding="async"
                  className="w-full h-full object-cover"
                />
              </a>
              <div className="flex items-center gap-1 pl-2 pr-0.5 py-0.5">
                <span
                  className="flex-1 min-w-0 truncate text-xs text-ink-muted"
                  title={[a.fileName, formatBytes(a.size, nf), a.uploaderName && t("attachmentAddedBy", locale).replace("{name}", a.uploaderName)]
                    .filter(Boolean)
                    .join(", ")}
                >
                  {a.fileName}
                </span>
                {a.canDelete && (
                  <button
                    type="button"
                    onClick={() => remove(a)}
                    aria-label={t("attachmentDelete", locale).replace("{name}", a.fileName)}
                    className={iconButtonClass("w-7 h-7 hover:text-danger")}
                  >
                    <Trash2 size={14} aria-hidden />
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      {files.length > 0 && (
        <ul aria-label={t("attachmentFiles", locale)} className="divide-y divide-line rounded-card border border-line bg-surface">
          {files.map((a) => (
            <li key={a.id} className={cn("flex items-center gap-2 px-2 py-1.5", deleting === a.id && "opacity-50")}>
              <FileText size={18} aria-hidden className="text-ink-muted shrink-0" />
              <div className="flex-1 min-w-0">
                <a
                  href={`/api/attachments/${a.id}?download=1`}
                  download={a.fileName}
                  className="block truncate text-sm font-medium hover:underline outline-none focus-visible:ring-2 focus-visible:ring-accent rounded-control"
                >
                  {a.fileName}
                </a>
                <span className="block text-xs text-ink-muted truncate">
                  {formatBytes(a.size, nf)}
                  {a.uploaderName && <> &middot; {t("attachmentAddedBy", locale).replace("{name}", a.uploaderName)}</>}
                  {" "}&middot; <RelativeTime iso={a.createdAt} locale={locale} />
                </span>
              </div>
              <a
                href={`/api/attachments/${a.id}?download=1`}
                download={a.fileName}
                aria-label={t("attachmentDownload", locale).replace("{name}", a.fileName)}
                className={iconButtonClass("w-7 h-7 shrink-0 outline-none focus-visible:ring-2 focus-visible:ring-accent")}
              >
                <Download size={14} aria-hidden />
              </a>
              {a.canDelete && (
                <button
                  type="button"
                  onClick={() => remove(a)}
                  aria-label={t("attachmentDelete", locale).replace("{name}", a.fileName)}
                  className={iconButtonClass("w-7 h-7 shrink-0 hover:text-danger")}
                >
                  <Trash2 size={14} aria-hidden />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
