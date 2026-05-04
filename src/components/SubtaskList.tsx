"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { t, type Locale } from "@/lib/i18n";
import {
  addSubtaskAction,
  deleteSubtaskAction,
  renameSubtaskAction,
  toggleSubtaskAction,
} from "@/server/tasks-actions";

export interface SubtaskItem {
  id: string;
  title: string;
  done: boolean;
}

export default function SubtaskList({
  cardId,
  subtasks,
  locale,
}: {
  cardId: string;
  subtasks: SubtaskItem[];
  locale: Locale;
}) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const total = subtasks.length;
  const done = subtasks.filter((s) => s.done).length;
  const pct = total === 0 ? 0 : Math.round((done / total) * 100);

  return (
    <div className="space-y-3">
      {total > 0 && (
        <div>
          <div className="flex items-center justify-between text-xs opacity-70">
            <span>
              {done}/{total}
            </span>
            <span>{pct}%</span>
          </div>
          <div className="h-1.5 rounded-full bg-slate-200 dark:bg-slate-700/60 overflow-hidden">
            <div className="h-full bg-brand-500" style={{ width: `${pct}%` }} />
          </div>
        </div>
      )}
      {subtasks.length === 0 && (
        <p className="text-sm opacity-60">{t("cardNoSubtasks", locale)}</p>
      )}
      <ul className="space-y-1">
        {subtasks.map((s) => (
          <li key={s.id} className="flex items-center gap-2">
            <form
              action={async (fd) => {
                await toggleSubtaskAction(fd);
                router.refresh();
              }}
            >
              <input type="hidden" name="subtaskId" value={s.id} />
              <button
                type="submit"
                aria-label={t("edit", locale)}
                className={`w-4 h-4 rounded border ${
                  s.done ? "bg-brand-600 border-brand-600" : "border-[var(--border)]"
                }`}
              >
                {s.done && (
                  <svg viewBox="0 0 16 16" className="text-white" width="16" height="16">
                    <path d="M3 8l3 3 7-7" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                )}
              </button>
            </form>
            {editing === s.id ? (
              <form
                action={async (fd) => {
                  await renameSubtaskAction(fd);
                  setEditing(null);
                  router.refresh();
                }}
                className="flex-1 flex gap-1"
              >
                <input type="hidden" name="subtaskId" value={s.id} />
                <input
                  name="title"
                  defaultValue={s.title}
                  autoFocus
                  required
                  maxLength={200}
                  className="!py-0.5 !px-2 text-sm"
                />
                <button className="text-xs rounded bg-brand-600 text-white px-2">
                  {t("save", locale)}
                </button>
              </form>
            ) : (
              <button
                type="button"
                onClick={() => setEditing(s.id)}
                className={`flex-1 text-left text-sm ${s.done ? "line-through opacity-60" : ""}`}
              >
                {s.title}
              </button>
            )}
            <form
              action={async (fd) => {
                await deleteSubtaskAction(fd);
                router.refresh();
              }}
            >
              <input type="hidden" name="subtaskId" value={s.id} />
              <button
                type="submit"
                className="text-xs opacity-50 hover:opacity-100 px-1"
                title={t("delete", locale)}
              >
                &times;
              </button>
            </form>
          </li>
        ))}
      </ul>
      <form
        ref={formRef}
        action={async (fd) => {
          await addSubtaskAction(fd);
          formRef.current?.reset();
          router.refresh();
        }}
        className="flex gap-2"
      >
        <input type="hidden" name="cardId" value={cardId} />
        <input
          name="title"
          required
          maxLength={200}
          placeholder={t("cardSubtaskAdd", locale)}
          className="text-sm"
        />
        <button className="rounded bg-brand-600 hover:bg-brand-700 text-white text-sm px-3">
          {t("add", locale)}
        </button>
      </form>
    </div>
  );
}
