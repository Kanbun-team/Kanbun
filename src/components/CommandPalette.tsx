"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import {
  Autocomplete,
  Dialog,
  Header,
  Input,
  ListBox,
  ListBoxItem,
  ListBoxSection,
  Modal,
  ModalOverlay,
  TextField,
} from "react-aria-components";
import { ArrowRight, FileText, Keyboard, LayoutGrid, ListTodo, Search, Settings, Trash2 } from "lucide-react";
import { t, type DictKey, type Locale } from "@/lib/i18n";
import { useUi } from "@/components/ui/UiProvider";
import { ShortcutsDialog } from "@/components/board/dialogs";
import { cn } from "@/lib/utils";
import { buildFtsQuery, matchesTerms, parseSnippet, searchTerms, squashWhitespace } from "@/lib/search-query";
import { searchAction, type SearchResults } from "@/server/search-actions";

// Global search and command palette (Cmd/Ctrl+K). Boards and cards come from
// the server (FTS5, see src/server/search-actions.ts); actions are filtered
// here. React Aria's Autocomplete keeps focus in the input and moves a virtual
// focus (aria-activedescendant) through the list.

const OPEN_EVENT = "kanbun:open-command-palette";
const DEBOUNCE_MS = 150;

/** Opens the palette from anywhere (the nav button uses this). */
export function openCommandPalette() {
  window.dispatchEvent(new Event(OPEN_EVENT));
}

function subscribeNothing() {
  return () => {};
}

function isApplePlatform(): boolean {
  return /Mac|iPhone|iPad|iPod/.test(navigator.platform || navigator.userAgent);
}

/** "⌘K" on Apple devices, "Ctrl K" elsewhere. Server render assumes Ctrl. */
function useShortcutLabel(locale: Locale): string {
  const apple = useSyncExternalStore(subscribeNothing, isApplePlatform, () => false);
  return apple ? "⌘K" : `${t("kbdCtrl", locale)} K`;
}

export function Kbd({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <kbd
      className={cn(
        "inline-flex items-center min-w-6 justify-center text-xs font-sans font-medium text-ink-muted border border-line-strong border-b-2 rounded-control px-1.5 bg-surface",
        className
      )}
    >
      {children}
    </kbd>
  );
}

/** "Search" in the top nav: a labelled button with the shortcut on wide
 * screens, an icon button (same accessible name, from its hidden text) on
 * phones. */
export function SearchButton({ locale }: { locale: Locale }) {
  const shortcut = useShortcutLabel(locale);
  return (
    <button
      type="button"
      onClick={openCommandPalette}
      aria-keyshortcuts="Control+K Meta+K"
      className={cn(
        "inline-flex items-center justify-center gap-2 rounded-control font-medium text-base text-ink-muted hover:text-ink transition-colors duration-[120ms]",
        "w-11 h-11 hover:bg-ink/5",
        "sm:w-auto sm:h-8 sm:pl-2 sm:pr-1.5 sm:border sm:border-line-strong sm:bg-surface sm:hover:bg-paper"
      )}
    >
      <Search size={16} aria-hidden className="max-sm:w-5 max-sm:h-5" />
      <span className="sr-only sm:not-sr-only">{t("search", locale)}</span>
      <Kbd className="hidden sm:inline-flex ml-2">
        <span aria-hidden>{shortcut}</span>
      </Kbd>
    </button>
  );
}

export default function CommandPalette() {
  const { locale } = useUi();
  const [open, setOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.isComposing || e.keyCode === 229) return;
      if (!(e.metaKey || e.ctrlKey) || e.altKey || e.shiftKey) return;
      if (e.key.toLowerCase() !== "k") return;
      e.preventDefault();
      e.stopPropagation();
      setOpen((o) => !o);
    }
    const onOpen = () => setOpen(true);
    window.addEventListener("keydown", onKey, true);
    window.addEventListener(OPEN_EVENT, onOpen);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener(OPEN_EVENT, onOpen);
    };
  }, []);

  return (
    <>
      <ModalOverlay
        isOpen={open}
        onOpenChange={setOpen}
        isDismissable
        className="fixed inset-0 z-[110] bg-black/40 flex items-start justify-center p-4 pt-[min(12vh,6rem)]"
      >
        <Modal className="w-full max-w-xl rounded-panel bg-raised text-ink shadow-float border border-line overflow-hidden">
          <Dialog aria-label={t("paletteLabel", locale)} className="outline-none">
            <PaletteBody
              locale={locale}
              onClose={() => setOpen(false)}
              onShortcuts={() => {
                setOpen(false);
                setShortcutsOpen(true);
              }}
            />
          </Dialog>
        </Modal>
      </ModalOverlay>
      <ShortcutsDialog open={shortcutsOpen} locale={locale} onClose={() => setShortcutsOpen(false)} />
    </>
  );
}

interface PaletteAction {
  id: string;
  label: DictKey;
  icon: ReactNode;
  run: () => void;
}

function PaletteBody({ locale, onClose, onShortcuts }: { locale: Locale; onClose: () => void; onShortcuts: () => void }) {
  const router = useRouter();
  const { report } = useUi();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<{ query: string; data: SearchResults } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const trimmed = query.trim();
  const hasTerms = buildFtsQuery(trimmed) !== null;

  useEffect(() => {
    if (!hasTerms) return;
    let cancelled = false;
    const timer = setTimeout(async () => {
      const res = await searchAction(trimmed);
      if (cancelled) return;
      if (res.ok) setResults({ query: trimmed, data: res.data });
      else report(res);
    }, DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [trimmed, hasTerms, report]);

  const go = useCallback(
    (href: string) => {
      onClose();
      router.push(href);
    },
    [onClose, router]
  );

  const actions: PaletteAction[] = useMemo(
    () => [
      { id: "my-tasks", label: "paletteGoMyTasks", icon: <ListTodo size={16} aria-hidden />, run: () => go("/tasks/me") },
      { id: "boards", label: "paletteGoBoards", icon: <LayoutGrid size={16} aria-hidden />, run: () => go("/tasks") },
      { id: "trash", label: "paletteOpenTrash", icon: <Trash2 size={16} aria-hidden />, run: () => go("/trash") },
      { id: "settings", label: "paletteOpenSettings", icon: <Settings size={16} aria-hidden />, run: () => go("/settings") },
      { id: "shortcuts", label: "paletteShortcuts", icon: <Keyboard size={16} aria-hidden />, run: onShortcuts },
    ],
    [go, onShortcuts]
  );

  // While a search is on its way the list stays empty, so React Aria moves the
  // virtual focus to the first result as soon as the results arrive.
  const pending = hasTerms && results?.query !== trimmed;
  const terms = searchTerms(trimmed);
  const data = hasTerms && !pending ? results?.data : undefined;
  const shownActions = pending ? [] : actions.filter((a) => matchesTerms(t(a.label, locale), terms));
  const boards = data?.boards ?? [];
  const cards = data?.cards ?? [];

  const runKey = (key: string) => {
    const [kind, id] = key.split(":");
    if (kind === "action") actions.find((a) => a.id === id)?.run();
    else if (kind === "board") go(`/tasks/${id}`);
    else if (kind === "card") {
      const card = cards.find((c) => c.id === id);
      if (card) go(`/tasks/${card.boardId}/cards/${card.id}`);
    }
  };

  const firstKey = boards[0]
    ? `board:${boards[0].id}`
    : cards[0]
      ? `card:${cards[0].id}`
      : shownActions[0]
        ? `action:${shownActions[0].id}`
        : null;

  const sectionClass = "py-1";
  const headerClass = "px-4 pt-2 pb-1 text-sm font-semibold text-ink-muted";
  const itemClass = ({ isFocused }: { isFocused: boolean }) =>
    cn(
      "mx-1 flex items-center gap-3 rounded-control px-3 py-2 cursor-default outline-none select-none text-base",
      isFocused && "bg-accent-soft"
    );

  return (
    <Autocomplete inputValue={query} onInputChange={setQuery}>
      <TextField aria-label={t("paletteSearchLabel", locale)} autoFocus className="flex items-center gap-2 border-b border-line px-4 focus-within:shadow-[inset_0_-2px_0_rgb(var(--accent))]">
        <Search size={18} aria-hidden className="text-ink-muted shrink-0" />
        <Input
          ref={inputRef}
          placeholder={t("paletteSearchLabel", locale)}
          className="flex-1 min-w-0 h-12 text-md text-ink placeholder:text-ink-muted !bg-transparent !border-0 !shadow-none !rounded-none !p-0 !outline-none"
          onKeyDown={(e) => {
            // Enter with nothing highlighted (after pasting or deleting text)
            // opens the top result.
            if (e.key === "Enter" && firstKey && !inputRef.current?.getAttribute("aria-activedescendant")) {
              e.preventDefault();
              runKey(firstKey);
            }
          }}
        />
        <Kbd className="shrink-0 hidden sm:inline-flex">Esc</Kbd>
      </TextField>
      <ListBox
        aria-label={t("paletteLabel", locale)}
        onAction={(key) => runKey(String(key))}
        className="max-h-[min(60vh,28rem)] overflow-y-auto py-1 outline-none"
        renderEmptyState={() => (
          <p className="px-4 py-6 text-base text-ink-muted" role={pending ? "status" : undefined}>
            {pending
              ? t("paletteSearching", locale)
              : t("paletteNoResults", locale).replace("{query}", trimmed)}
          </p>
        )}
      >
        {boards.length > 0 && (
          <ListBoxSection id="boards" className={sectionClass}>
            <Header className={headerClass}>{t("paletteGroupBoards", locale)}</Header>
            {boards.map((b) => (
              <ListBoxItem key={b.id} id={`board:${b.id}`} textValue={b.name} className={itemClass}>
                <span aria-hidden className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: b.color }} />
                <span className="flex-1 min-w-0 truncate">{b.name}</span>
                <ArrowRight size={16} aria-hidden className="text-ink-muted shrink-0" />
              </ListBoxItem>
            ))}
          </ListBoxSection>
        )}
        {cards.length > 0 && (
          <ListBoxSection id="cards" className={sectionClass}>
            <Header className={headerClass}>{t("paletteGroupCards", locale)}</Header>
            {cards.map((c) => (
              <ListBoxItem key={c.id} id={`card:${c.id}`} textValue={c.title} className={itemClass}>
                <FileText size={16} aria-hidden className="text-ink-muted shrink-0 self-start mt-0.5" />
                <span className="flex-1 min-w-0">
                  <span className="block truncate font-medium">{c.title}</span>
                  <span className="block truncate text-sm text-ink-muted">
                    {t("paletteCardLocation", locale).replace("{column}", c.columnName).replace("{board}", c.boardName)}
                  </span>
                  {c.snippet && <Snippet text={c.snippet} />}
                </span>
              </ListBoxItem>
            ))}
          </ListBoxSection>
        )}
        {shownActions.length > 0 && (
          <ListBoxSection id="actions" className={sectionClass}>
            <Header className={headerClass}>{t("paletteGroupActions", locale)}</Header>
            {shownActions.map((a) => (
              <ListBoxItem key={a.id} id={`action:${a.id}`} textValue={t(a.label, locale)} className={itemClass}>
                <span className="text-ink-muted shrink-0">{a.icon}</span>
                <span className="flex-1 min-w-0 truncate">{t(a.label, locale)}</span>
              </ListBoxItem>
            ))}
          </ListBoxSection>
        )}
      </ListBox>
      {!hasTerms && <p className="px-4 py-3 border-t border-line text-sm text-ink-muted">{t("paletteHint", locale)}</p>}
    </Autocomplete>
  );
}

/** Renders FTS5 snippet markers as highlighted text, never as HTML. */
function Snippet({ text }: { text: string }) {
  const parts = parseSnippet(squashWhitespace(text));
  return (
    <span className="block truncate text-sm text-ink-muted">
      {parts.map((part, i) =>
        part.match ? (
          <mark key={i} className="bg-transparent font-semibold text-ink">
            {part.text}
          </mark>
        ) : (
          <span key={i}>{part.text}</span>
        )
      )}
    </span>
  );
}
