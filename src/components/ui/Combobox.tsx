"use client";

import { useState, type KeyboardEvent, type ReactNode } from "react";
import {
  Autocomplete,
  Button,
  Dialog,
  DialogTrigger,
  Input,
  ListBox,
  ListBoxItem,
  Popover,
  SearchField,
  useFilter,
  type Key,
  type Selection,
} from "react-aria-components";
import { Check, Search } from "lucide-react";
import { cn } from "@/lib/utils";

// Searchable picker (React Aria Autocomplete + ListBox in a popover). Replaces
// native <select> for long lists: type to filter (accents and case ignored),
// arrow keys to move, Enter to pick, Escape to clear the search, then close.
//
// - single: pick one option, the popover closes (onSelect).
// - multiple: options toggle and the popover stays open (onToggle); the
//   checked state comes from `selectedIds`, so pass an optimistic value.

export interface ComboboxOption {
  id: string;
  label: string;
  /** Second line, also searchable (a username, a column name). */
  description?: string;
  /** Extra search terms that are not shown. */
  keywords?: string;
  /** Avatar, color dot, icon. */
  leading?: ReactNode;
}

type SelectionProps =
  | { selectionMode: "multiple"; selectedIds: string[]; onToggle: (id: string) => void }
  | { selectionMode?: "single"; onSelect: (id: string) => void };

export type ComboboxProps = SelectionProps & {
  /** Accessible name of the trigger and the popover. */
  label: string;
  /** Placeholder and accessible name of the search field. */
  searchLabel: string;
  /** Shown when nothing matches (or there are no options). */
  emptyText: string;
  options: ComboboxOption[];
  /** Visible trigger content; the trigger is labelled by `label` either way. */
  trigger: ReactNode;
  triggerClassName?: string;
  isDisabled?: boolean;
};

export default function Combobox(props: ComboboxProps) {
  const { label, searchLabel, emptyText, options, trigger, triggerClassName, isDisabled } = props;
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const { contains } = useFilter({ sensitivity: "base" });
  const multiple = props.selectionMode === "multiple";
  const selectedIds = props.selectionMode === "multiple" ? props.selectedIds : null;

  function onSelectionChange(keys: Selection) {
    if (props.selectionMode !== "multiple" || keys === "all") return;
    const before = new Set(props.selectedIds);
    const after = new Set([...keys].map(String));
    for (const id of after) if (!before.has(id)) return props.onToggle(id);
    for (const id of before) if (!after.has(id)) return props.onToggle(id);
  }

  function onOpenChange(next: boolean) {
    setOpen(next);
    if (!next) setQuery("");
  }

  function onAction(key: Key) {
    if (props.selectionMode === "multiple") return;
    onOpenChange(false);
    props.onSelect(String(key));
  }

  // Escape clears the search first; with an empty search it closes the picker
  // right away (React Aria would spend one more press on the virtual focus).
  function onKeyDownCapture(e: KeyboardEvent) {
    if (e.key !== "Escape" || query !== "") return;
    e.preventDefault();
    e.stopPropagation();
    onOpenChange(false);
  }

  return (
    <DialogTrigger isOpen={open} onOpenChange={onOpenChange}>
      <Button
        aria-label={label}
        isDisabled={isDisabled}
        className={cn(
          "outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-50",
          triggerClassName
        )}
      >
        {trigger}
      </Button>
      <Popover
        placement="bottom start"
        className="w-72 max-w-[calc(100vw-2rem)] rounded-panel border border-line bg-raised text-ink shadow-float outline-none"
      >
        {/* One scroll area for search and list, so it holds a focusable element (axe). */}
        <Dialog aria-label={label} className="outline-none">
          <div onKeyDownCapture={onKeyDownCapture} className="max-h-80 overflow-auto px-1.5 pb-1.5">
            <Autocomplete filter={contains} inputValue={query} onInputChange={setQuery}>
              <SearchField aria-label={searchLabel} autoFocus className="sticky top-0 z-10 bg-raised pt-1.5 pb-1.5">
                <Search
                  size={14}
                  aria-hidden
                  className="absolute left-2.5 top-[1.125rem] text-ink-muted pointer-events-none"
                />
                <Input placeholder={searchLabel} className="!pl-8 !py-1.5 [&::-webkit-search-cancel-button]:hidden" />
              </SearchField>
              <ListBox
                aria-label={label}
                items={options}
                selectionMode={multiple ? "multiple" : "none"}
                selectedKeys={selectedIds ?? undefined}
                onSelectionChange={multiple ? onSelectionChange : undefined}
                onAction={multiple ? undefined : onAction}
                renderEmptyState={() => <div className="px-2 py-1.5 text-sm text-ink-muted">{emptyText}</div>}
                className="outline-none"
              >
                {(o) => (
                  <ListBoxItem
                    id={o.id}
                    textValue={[o.label, o.description, o.keywords].filter(Boolean).join(" ")}
                    className={cn(
                      "flex items-center gap-2 px-2 py-1.5 rounded-control cursor-default outline-none select-none",
                      "hover:bg-ink/5 data-[focused]:bg-ink/5 data-[focus-visible]:ring-2 data-[focus-visible]:ring-accent",
                      "data-[selected]:bg-accent-soft"
                    )}
                  >
                    {({ isSelected }) => (
                      <>
                        {o.leading && (
                          <span aria-hidden="true" className="shrink-0 flex">
                            {o.leading}
                          </span>
                        )}
                        <span className="flex-1 min-w-0">
                          <span className="block text-sm truncate">{o.label}</span>
                          {o.description && (
                            <span className="block text-xs text-ink-muted truncate">{o.description}</span>
                          )}
                        </span>
                        {isSelected && <Check size={14} aria-hidden className="text-accent shrink-0" />}
                      </>
                    )}
                  </ListBoxItem>
                )}
              </ListBox>
            </Autocomplete>
          </div>
        </Dialog>
      </Popover>
    </DialogTrigger>
  );
}
