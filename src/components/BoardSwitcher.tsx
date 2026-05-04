"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { t, type Locale } from "@/lib/i18n";

interface Props {
  boards: { id: string; name: string }[];
  locale: Locale;
}

export default function BoardSwitcher({ boards, locale }: Props) {
  const pathname = usePathname();
  const ref = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);

  const currentBoardId = useMemo(() => {
    const m = pathname?.match(/^\/tasks\/([^/]+)/);
    if (!m) return null;
    if (m[1] === "me") return null;
    return m[1];
  }, [pathname]);

  const current = useMemo(
    () => boards.find((b) => b.id === currentBoardId) ?? null,
    [boards, currentBoardId]
  );

  useEffect(() => {
    if (!open) return;
    function onClick(e: MouseEvent) {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  if (!current) return null;

  const others = boards.filter((b) => b.id !== current.id);

  return (
    <div className="relative ml-2" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        className="flex items-center gap-1 px-3 py-1.5 rounded-md hover:bg-slate-100 dark:hover:bg-slate-800 max-w-[220px]"
      >
        <span className="truncate font-medium">{current.name}</span>
        <svg
          width="14"
          height="14"
          viewBox="0 0 20 20"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="opacity-60 shrink-0"
          aria-hidden="true"
        >
          <path d="M5 8l5 5 5-5" />
        </svg>
      </button>
      {open && (
        <div
          role="menu"
          className="absolute mt-2 w-64 rounded-xl surface border shadow-lg z-50 max-h-80 overflow-auto"
        >
          {others.length === 0 ? (
            <div className="px-4 py-2 text-xs opacity-60">{t("noResults", locale)}</div>
          ) : (
            others.map((b) => (
              <Link
                key={b.id}
                href={`/tasks/${b.id}`}
                className="block px-4 py-2 text-sm hover:bg-slate-100 dark:hover:bg-slate-800 truncate"
              >
                {b.name}
              </Link>
            ))
          )}
          <Link
            href="/tasks"
            className="block px-4 py-2 text-sm font-medium border-t border-[var(--border)] hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            {t("boardsTitle", locale)}
          </Link>
        </div>
      )}
    </div>
  );
}
