"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
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
import {
  ArrowLeft,
  ArrowRight,
  FileText,
  Flag,
  Keyboard,
  LayoutGrid,
  ListTodo,
  MoveRight,
  Plus,
  Search,
  Settings,
  Trash2,
  UserMinus,
  UserPlus,
} from "lucide-react";
import { t, type DictKey, type Locale } from "@/lib/i18n";
import { useUi } from "@/components/ui/UiProvider";
import { ShortcutsDialog } from "@/components/board/dialogs";
import { cn } from "@/lib/utils";
import { buildFtsQuery, matchesTerms, parseSnippet, searchTerms, squashWhitespace } from "@/lib/search-query";
import { searchAction, type SearchResults } from "@/server/search-actions";
import { paletteBoardAction, paletteCardAction, type PaletteBoard, type PaletteCard, type PaletteColumn } from "@/server/palette-actions";
import { addCardAction, moveCardAction, toggleAssigneeAction, updateCardAction } from "@/server/tasks-actions";
import { PRIORITIES, priorityLabel } from "@/lib/labels";
import { markLocalCards } from "@/components/board/live-changes";
import type { ActionResult } from "@/lib/action-result";

// Global search and command palette (Cmd/Ctrl+K). Boards and cards come from
// the server (FTS5, see src/server/search-actions.ts); actions are filtered
// here. React Aria's Autocomplete keeps focus in the input and moves a virtual
// focus (aria-activedescendant) through the list.
//
// Card actions (open, move to a column, assign to me, priority): for the card
// on screen they are listed under its title; for a card in the results, the
// right arrow switches the palette to that card's actions (Escape or
// Backspace goes back). On a board, "New card on <board>" asks for a title
// and adds the card to the first column.

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

interface PaletteItem {
  id: string;
  label: string;
  icon: ReactNode;
  run: () => void;
}

type Mode =
  | { kind: "search" }
  | { kind: "card"; card: PaletteCard }
  | { kind: "loading"; title: string }
  | { kind: "newCard"; board: PaletteBoard; column: PaletteColumn };

/** The board or card the page behind the palette shows, from the URL. */
function pageContext(pathname: string): { boardId: string; cardId: string | null } | null {
  const m = /^\/tasks\/([^/]+)(?:\/cards\/([^/]+))?\/?$/.exec(pathname);
  if (!m || m[1] === "me" || m[1] === "import") return null;
  return { boardId: m[1], cardId: m[2] ?? null };
}

const fd = (fields: Record<string, string>) => {
  const form = new FormData();
  for (const [k, v] of Object.entries(fields)) form.set(k, v);
  return form;
};

function PaletteBody({ locale, onClose, onShortcuts }: { locale: Locale; onClose: () => void; onShortcuts: () => void }) {
  const router = useRouter();
  const pathname = usePathname();
  const ui = useUi();
  const { report } = ui;
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<{ query: string; data: SearchResults } | null>(null);
  const [mode, setMode] = useState<Mode>({ kind: "search" });
  const [context, setContext] = useState<{ board: PaletteBoard | null; card: PaletteCard | null }>({ board: null, card: null });
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const tr = (key: DictKey, vars: Record<string, string> = {}) =>
    Object.entries(vars).reduce((s, [k, v]) => s.replaceAll(`{${k}}`, v), t(key, locale));

  const trimmed = query.trim();
  const searching = mode.kind === "search";
  const hasTerms = searching && buildFtsQuery(trimmed) !== null;

  // The board or card on screen: its actions are offered without searching.
  const page = pageContext(pathname);
  const pageBoardId = page?.boardId ?? null;
  const pageCardId = page?.cardId ?? null;
  useEffect(() => {
    if (!pageBoardId) return;
    let cancelled = false;
    (async () => {
      if (pageCardId) {
        const res = await paletteCardAction(pageCardId);
        if (!cancelled && res.ok) setContext({ board: res.data.board, card: res.data });
      } else {
        const res = await paletteBoardAction(pageBoardId);
        if (!cancelled && res.ok) setContext({ board: res.data, card: null });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [pageBoardId, pageCardId]);

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

  /** Runs a card change, then closes with a confirmation. */
  async function change(run: () => Promise<ActionResult<unknown>>, message: string) {
    if (busy) return;
    setBusy(true);
    const result = ui.report(await run());
    setBusy(false);
    if (!result.ok) return;
    onClose();
    ui.toast({ message });
    router.refresh();
  }

  function back() {
    setMode({ kind: "search" });
    setQuery("");
  }

  async function openCardMode(cardId: string, title: string) {
    setMode({ kind: "loading", title });
    setQuery("");
    const res = await paletteCardAction(cardId);
    if (!res.ok) {
      report(res);
      setMode({ kind: "search" });
      return;
    }
    setMode({ kind: "card", card: res.data });
  }

  function cardItems(card: PaletteCard): PaletteItem[] {
    const items: PaletteItem[] = [];
    if (card.id !== pageCardId) {
      items.push({
        id: "open",
        label: t("paletteCardOpen", locale),
        icon: <FileText size={16} aria-hidden />,
        run: () => go(`/tasks/${card.boardId}/cards/${card.id}`),
      });
    }
    for (const col of card.board.columns) {
      if (col.id === card.columnId) continue;
      items.push({
        id: `move:${col.id}`,
        label: tr("paletteCardMove", { column: col.name }),
        icon: <MoveRight size={16} aria-hidden />,
        run: () =>
          change(
            () => moveCardAction({ cardId: card.id, toColumnId: col.id, position: END_OF_COLUMN }),
            tr("paletteCardMoved", { title: card.title, column: col.name })
          ),
      });
    }
    if (card.canAssignMe) {
      const on = !card.assignedToMe;
      items.push({
        id: "assign",
        label: t(on ? "paletteCardAssignMe" : "paletteCardUnassignMe", locale),
        icon: on ? <UserPlus size={16} aria-hidden /> : <UserMinus size={16} aria-hidden />,
        run: () =>
          change(
            () => toggleAssigneeAction(fd({ cardId: card.id, userId: card.meId, on: on ? "1" : "0" })),
            tr(on ? "paletteCardAssigned" : "paletteCardUnassigned", { title: card.title })
          ),
      });
    }
    for (const p of PRIORITIES) {
      if (p === card.priority) continue;
      const label = priorityLabel(p, locale);
      items.push({
        id: `priority:${p}`,
        label: tr("paletteCardPriority", { priority: label }),
        icon: <Flag size={16} aria-hidden />,
        run: () =>
          change(
            () => updateCardAction(fd({ cardId: card.id, priority: p })),
            tr("paletteCardPrioritySet", { title: card.title, priority: label })
          ),
      });
    }
    return items;
  }

  const actions: PaletteItem[] = useMemo(() => {
    const list: PaletteItem[] = [];
    const board = context.board;
    if (board && board.columns.length > 0) {
      list.push({
        id: "new-card",
        label: t("paletteNewCard", locale).replace("{board}", board.name),
        icon: <Plus size={16} aria-hidden />,
        run: () => {
          setMode({ kind: "newCard", board, column: board.columns[0] });
          setQuery("");
        },
      });
    }
    const fixed: [string, DictKey, ReactNode, () => void][] = [
      ["my-tasks", "paletteGoMyTasks", <ListTodo key="i" size={16} aria-hidden />, () => go("/tasks/me")],
      ["boards", "paletteGoBoards", <LayoutGrid key="i" size={16} aria-hidden />, () => go("/tasks")],
      ["trash", "paletteOpenTrash", <Trash2 key="i" size={16} aria-hidden />, () => go("/trash")],
      ["settings", "paletteOpenSettings", <Settings key="i" size={16} aria-hidden />, () => go("/settings")],
      ["shortcuts", "paletteShortcuts", <Keyboard key="i" size={16} aria-hidden />, onShortcuts],
    ];
    for (const [id, label, icon, run] of fixed) list.push({ id, label: t(label, locale), icon, run });
    return list;
  }, [context.board, go, locale, onShortcuts]);

  // While a search is on its way the list stays empty, so React Aria moves the
  // virtual focus to the first result as soon as the results arrive.
  const pending = hasTerms && results?.query !== trimmed;
  const terms = searchTerms(trimmed);
  const data = hasTerms && !pending ? results?.data : undefined;
  const boards = searching ? data?.boards ?? [] : [];
  const cards = searching ? data?.cards ?? [] : [];
  const filter = (items: PaletteItem[]) => (pending ? [] : items.filter((a) => matchesTerms(a.label, terms)));
  const shownActions = searching ? filter(actions) : [];
  const contextCard = searching ? context.card : null;
  const shownContext = contextCard ? filter(cardItems(contextCard)) : [];
  const modeCard = mode.kind === "card" ? mode.card : null;
  const shownCardItems = modeCard ? filter(cardItems(modeCard)) : [];

  const runKey = (key: string) => {
    const [kind, id] = [key.slice(0, key.indexOf(":")), key.slice(key.indexOf(":") + 1)];
    if (kind === "action") actions.find((a) => a.id === id)?.run();
    else if (kind === "context" && contextCard) cardItems(contextCard).find((a) => a.id === id)?.run();
    else if (kind === "cardAction" && modeCard) cardItems(modeCard).find((a) => a.id === id)?.run();
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
      : shownContext[0]
        ? `context:${shownContext[0].id}`
        : shownCardItems[0]
          ? `cardAction:${shownCardItems[0].id}`
          : shownActions[0]
            ? `action:${shownActions[0].id}`
            : null;

  /** The key of the option React Aria highlights (aria-activedescendant). */
  function activeKey(): string | null {
    const id = inputRef.current?.getAttribute("aria-activedescendant");
    const el = id ? document.getElementById(id) : null;
    return el?.querySelector<HTMLElement>("[data-palette-key]")?.dataset.paletteKey ?? null;
  }

  const sectionClass = "py-1";
  const headerClass = "px-4 pt-2 pb-1 text-sm font-semibold text-ink-muted";
  const itemClass = ({ isFocused }: { isFocused: boolean }) =>
    cn(
      "mx-1 flex items-center gap-3 rounded-control px-3 py-2 cursor-default outline-none select-none text-base",
      isFocused && "bg-accent-soft"
    );
  const itemRow = (prefix: string, a: PaletteItem) => (
    <ListBoxItem key={a.id} id={`${prefix}:${a.id}`} textValue={a.label} className={itemClass}>
      <span hidden data-palette-key={`${prefix}:${a.id}`} />
      <span className="text-ink-muted shrink-0">{a.icon}</span>
      <span className="flex-1 min-w-0 truncate">{a.label}</span>
    </ListBoxItem>
  );

  if (mode.kind === "newCard") {
    return (
      <NewCardForm
        locale={locale}
        board={mode.board}
        column={mode.column}
        busy={busy}
        onBack={back}
        onSubmit={async (title) => {
          if (busy) return;
          setBusy(true);
          const result = ui.report(await addCardAction(fd({ columnId: mode.column.id, title })));
          setBusy(false);
          if (!result.ok) return;
          const [id] = result.data.ids;
          markLocalCards(result.data.ids);
          go(`/tasks/${mode.board.id}/cards/${id}`);
        }}
      />
    );
  }

  const scoped = mode.kind === "card" || mode.kind === "loading";
  const scopeTitle = mode.kind === "card" ? mode.card.title : mode.kind === "loading" ? mode.title : "";
  const inputLabel = scoped ? tr("paletteCardActionsLabel", { title: scopeTitle }) : t("paletteSearchLabel", locale);

  return (
    <Autocomplete inputValue={query} onInputChange={setQuery}>
      {scoped && <ScopeBar locale={locale} title={scopeTitle} onBack={back} />}
      <TextField aria-label={inputLabel} autoFocus className="flex items-center gap-2 border-b border-line px-4 focus-within:shadow-[inset_0_-2px_0_rgb(var(--accent))]">
        <Search size={18} aria-hidden className="text-ink-muted shrink-0" />
        <Input
          ref={inputRef}
          placeholder={scoped ? t("paletteCardActionsPlaceholder", locale) : t("paletteSearchLabel", locale)}
          className="flex-1 min-w-0 h-12 text-md text-ink placeholder:text-ink-muted !bg-transparent !border-0 !shadow-none !rounded-none !p-0 !outline-none"
          onKeyDown={(e) => {
            const input = e.currentTarget;
            if (scoped && (e.key === "Escape" || (e.key === "Backspace" && input.value === ""))) {
              // Back to the search instead of closing the palette.
              e.preventDefault();
              e.stopPropagation();
              back();
              return;
            }
            if (searching && e.key === "ArrowRight" && input.selectionStart === input.value.length) {
              // Card actions for the highlighted card result.
              const key = activeKey();
              if (key?.startsWith("card:")) {
                const card = cards.find((c) => `card:${c.id}` === key);
                if (card) {
                  e.preventDefault();
                  void openCardMode(card.id, card.title);
                }
              }
              return;
            }
            // Enter with nothing highlighted (after pasting or deleting text)
            // opens the top result.
            if (e.key === "Enter" && firstKey && !input.getAttribute("aria-activedescendant")) {
              e.preventDefault();
              runKey(firstKey);
            }
          }}
        />
        <Kbd className="shrink-0 hidden sm:inline-flex">Esc</Kbd>
      </TextField>
      <ListBox
        aria-label={scoped ? inputLabel : t("paletteLabel", locale)}
        onAction={(key) => runKey(String(key))}
        className="max-h-[min(60vh,28rem)] overflow-y-auto py-1 outline-none"
        renderEmptyState={() => (
          <p className="px-4 py-6 text-base text-ink-muted" role={pending || mode.kind === "loading" ? "status" : undefined}>
            {pending || mode.kind === "loading"
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
                <span hidden data-palette-key={`board:${b.id}`} />
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
                <span hidden data-palette-key={`card:${c.id}`} />
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
        {shownContext.length > 0 && contextCard && (
          <ListBoxSection id="context" className={sectionClass}>
            <Header className={headerClass}>{tr("paletteGroupThisCard", { title: contextCard.title })}</Header>
            {shownContext.map((a) => itemRow("context", a))}
          </ListBoxSection>
        )}
        {shownCardItems.length > 0 && (
          <ListBoxSection id="card-actions" className={sectionClass}>
            {shownCardItems.map((a) => itemRow("cardAction", a))}
          </ListBoxSection>
        )}
        {shownActions.length > 0 && (
          <ListBoxSection id="actions" className={sectionClass}>
            <Header className={headerClass}>{t("paletteGroupActions", locale)}</Header>
            {shownActions.map((a) => itemRow("action", a))}
          </ListBoxSection>
        )}
      </ListBox>
      {searching && !hasTerms && <p className="px-4 py-3 border-t border-line text-sm text-ink-muted">{t("paletteHint", locale)}</p>}
      {searching && cards.length > 0 && (
        <p className="hidden sm:flex items-center gap-1.5 px-4 py-2 border-t border-line text-sm text-ink-muted">
          <Kbd>
            <span aria-hidden>→</span>
            <span className="sr-only">{t("paletteKeyRight", locale)}</span>
          </Kbd>
          {t("paletteCardActionsHint", locale)}
        </p>
      )}
    </Autocomplete>
  );
}

/** Position past the end: the server puts the card last in the column. */
const END_OF_COLUMN = 1_000_000;

function ScopeBar({ locale, title, onBack }: { locale: Locale; title: string; onBack: () => void }) {
  return (
    <div className="flex items-center gap-2 border-b border-line px-2 py-1.5 text-sm text-ink-muted">
      <button
        type="button"
        onClick={onBack}
        className="inline-flex items-center gap-1 rounded-control px-2 min-h-8 hover:text-ink hover:bg-ink/5"
      >
        <ArrowLeft size={14} aria-hidden />
        {t("paletteBack", locale)}
      </button>
      <span aria-hidden>/</span>
      <span className="truncate font-medium text-ink">{title}</span>
    </div>
  );
}

function NewCardForm({
  locale,
  board,
  column,
  busy,
  onBack,
  onSubmit,
}: {
  locale: Locale;
  board: PaletteBoard;
  column: PaletteColumn;
  busy: boolean;
  onBack: () => void;
  onSubmit: (title: string) => void;
}) {
  const [title, setTitle] = useState("");
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const value = title.trim();
        if (value) onSubmit(value);
      }}
    >
      <ScopeBar locale={locale} title={t("paletteNewCard", locale).replace("{board}", board.name)} onBack={onBack} />
      <label className="flex items-center gap-2 border-b border-line px-4 focus-within:shadow-[inset_0_-2px_0_rgb(var(--accent))]">
        <Plus size={18} aria-hidden className="text-ink-muted shrink-0" />
        <span className="sr-only">{t("paletteNewCardTitle", locale)}</span>
        <input
          autoFocus
          required
          maxLength={200}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape" || (e.key === "Backspace" && title === "")) {
              e.preventDefault();
              e.stopPropagation();
              onBack();
            }
          }}
          placeholder={t("paletteNewCardTitle", locale)}
          aria-describedby="palette-new-card-hint"
          className="flex-1 min-w-0 h-12 text-md text-ink placeholder:text-ink-muted !bg-transparent !border-0 !shadow-none !rounded-none !p-0 !outline-none"
        />
        <Kbd className="shrink-0 hidden sm:inline-flex">Enter</Kbd>
      </label>
      <p id="palette-new-card-hint" className="px-4 py-3 text-sm text-ink-muted" aria-live="polite">
        {busy ? t("paletteAdding", locale) : t("paletteNewCardHint", locale).replace("{column}", column.name)}
      </p>
    </form>
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
