"use client";

import { useId, useRef, useState, type KeyboardEvent, type TextareaHTMLAttributes } from "react";
import { flushSync } from "react-dom";
import Avatar from "./Avatar";
import { cn } from "@/lib/utils";
import { t, type Locale } from "@/lib/i18n";
import { activeMention, filterMentionCandidates, insertMention, type MentionCandidate } from "@/lib/mentions";

// A textarea that suggests board members after "@". Keyboard: arrows move,
// Enter or Tab inserts "@username ", Escape closes the list (and only the
// list, not the card panel around it). The textarea keeps focus and points at
// the highlighted option with aria-activedescendant; a polite live region
// announces how many people match.

type Props = Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "value" | "onChange"> & {
  value: string;
  onValueChange: (value: string) => void;
  members: MentionCandidate[];
  locale: Locale;
};

export default function MentionTextarea({ value, onValueChange, members, locale, className, ...rest }: Props) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const listId = useId();
  const [mention, setMention] = useState<{ start: number; query: string } | null>(null);
  const [active, setActive] = useState(0);
  // Escape hides the list for this one "@" until the user types elsewhere.
  const [dismissed, setDismissed] = useState<number | null>(null);

  const suggestions =
    mention && mention.start !== dismissed ? filterMentionCandidates(members, mention.query) : [];
  const open = suggestions.length > 0;
  const activeIndex = Math.min(active, suggestions.length - 1);
  const optionId = (i: number) => `${listId}-option-${i}`;

  function track(text: string, caret: number) {
    const next = activeMention(text, caret);
    if (next?.query !== mention?.query || next?.start !== mention?.start) setActive(0);
    if (!next || next.start !== dismissed) setDismissed(null);
    setMention(next);
  }

  function pick(username: string) {
    const el = ref.current;
    if (!el || !mention) return;
    const next = insertMention(value, mention.start, el.selectionStart, username);
    flushSync(() => {
      onValueChange(next.text);
      setMention(null);
    });
    el.focus();
    el.setSelectionRange(next.caret, next.caret);
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (!open) return;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const n = suggestions.length;
      setActive((activeIndex + (e.key === "ArrowDown" ? 1 : n - 1)) % n);
    } else if ((e.key === "Enter" || e.key === "Tab") && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      pick(suggestions[activeIndex].username);
    } else if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      setDismissed(mention?.start ?? null);
    }
  }

  return (
    <div className="relative">
      <textarea
        {...rest}
        ref={ref}
        value={value}
        className={className}
        onChange={(e) => {
          onValueChange(e.target.value);
          track(e.target.value, e.target.selectionStart);
        }}
        onSelect={(e) => track(e.currentTarget.value, e.currentTarget.selectionStart)}
        onBlur={() => setMention(null)}
        onKeyDown={onKeyDown}
        aria-autocomplete="list"
        aria-controls={open ? listId : undefined}
        aria-activedescendant={open ? optionId(activeIndex) : undefined}
      />
      {open && (
        <ul
          id={listId}
          role="listbox"
          aria-label={t("mentionSuggestions", locale)}
          className="absolute left-0 bottom-full mb-1 z-10 w-72 max-w-full rounded-panel border border-line bg-raised shadow-float p-1"
        >
          {suggestions.map((m, i) => {
            const name = m.displayName ?? m.username;
            return (
              <li
                key={m.id}
                id={optionId(i)}
                role="option"
                aria-selected={i === activeIndex}
                // Keep focus in the textarea when clicking an option.
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => pick(m.username)}
                onMouseMove={() => i !== activeIndex && setActive(i)}
                className={cn(
                  "flex items-center gap-2 px-2 py-1.5 rounded-control cursor-default select-none",
                  i === activeIndex && "bg-accent-soft"
                )}
              >
                <span aria-hidden="true" className="shrink-0 flex">
                  <Avatar src={m.avatarUrl} name={name} size={22} />
                </span>
                <span className="text-sm text-ink truncate">{name}</span>
                <span className="text-xs text-ink-muted truncate">@{m.username}</span>
              </li>
            );
          })}
        </ul>
      )}
      <div aria-live="polite" className="sr-only">
        {open ? t("mentionSuggestionsCount", locale).replace("{count}", String(suggestions.length)) : ""}
      </div>
    </div>
  );
}
