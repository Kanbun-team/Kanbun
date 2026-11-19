"use client";

import { useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import Avatar from "./Avatar";
import MentionTextarea from "./MentionTextarea";
import RelativeTime from "./ui/RelativeTime";
import { addCommentAction, deleteCommentAction } from "@/server/tasks-actions";
import { t, type Locale } from "@/lib/i18n";
import { renderMarkdownToHtml } from "@/lib/markdown";
import { activityRule, describeActivity } from "@/lib/activity";
import { undoAutomationRunAction } from "@/server/automation-actions";
import type { MentionCandidate } from "@/lib/mentions";
import { cn } from "@/lib/utils";
import { useUi } from "./ui/UiProvider";
import { buttonClass } from "./ui/button";
import { useOnline } from "@/lib/use-online";
import { sendOrWarn } from "./ui/offline";
import { newId } from "@/lib/outbox";

export interface CommentItem {
  id: string;
  body: string;
  createdAt: string;
  /** Null when the author's account was deleted. */
  author: { id: string; username: string; displayName: string | null; avatarUrl: string | null } | null;
  canDelete: boolean;
}

export interface ActivityItem {
  id: string;
  type: string;
  data: Record<string, unknown>;
  createdAt: string;
  /** Null when the actor's account was deleted. */
  actor: { username: string; displayName: string | null } | null;
  /** On the last entry of an automation rule run that can still be undone. */
  undoRunId?: string;
}

type TimelineEntry = ({ kind: "comment" } & CommentItem) | ({ kind: "activity" } & ActivityItem);

// The card timeline: comments and history (moves, edits, assignments) in one
// list, oldest first, with the comment box at the end.
export default function Comments({
  cardId,
  comments,
  activity = [],
  members = [],
  mentionable = [],
  locale,
}: {
  cardId: string;
  comments: CommentItem[];
  activity?: ActivityItem[];
  /** Board members offered after "@" in the comment box. */
  members?: MentionCandidate[];
  /** Existing usernames whose @mentions are highlighted in comments. */
  mentionable?: string[];
  locale: Locale;
}) {
  const router = useRouter();
  const ui = useUi();
  const [pending, startTransition] = useTransition();
  const [body, setBody] = useState("");
  const online = useOnline();
  const [commentsOnly, setCommentsOnly] = useState(false);
  // One idempotency key per draft: sending the same text again after a
  // dropped connection reuses it, so the server does not post it twice.
  // Changing the text makes it a new comment with a new key.
  const draftKey = useRef<{ body: string; key: string } | null>(null);
  function keyFor(text: string): string {
    if (draftKey.current?.body !== text) draftKey.current = { body: text, key: newId() };
    return draftKey.current.key;
  }

  const entries: TimelineEntry[] = [
    ...comments.map((c) => ({ kind: "comment" as const, ...c })),
    ...(commentsOnly ? [] : activity.map((a) => ({ kind: "activity" as const, ...a }))),
  ].sort((a, b) => a.createdAt.localeCompare(b.createdAt));

  function undoRule(runId: string) {
    if (!online) return;
    startTransition(async () => {
      if (ui.report(await undoAutomationRunAction(runId)).ok) {
        ui.toast({ message: t("automationUndoneToast", locale) });
        router.refresh();
      }
    });
  }

  async function remove(commentId: string) {
    // Confirm first: state set inside an async transition commits only at its end.
    const ok = await ui.confirm({
      title: t("confirmDeleteComment", locale),
      confirmLabel: t("delete", locale),
      danger: true,
    });
    if (!ok) return;
    startTransition(async () => {
      const fd = new FormData();
      fd.set("commentId", commentId);
      if (ui.report(await deleteCommentAction(fd)).ok) {
        ui.toast({ message: t("commentDeleted", locale) });
        router.refresh();
      }
    });
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h2 className="text-md font-semibold">{t("cardActivity", locale)}</h2>
        {activity.length > 0 && (
          <button
            type="button"
            aria-pressed={commentsOnly}
            onClick={() => setCommentsOnly((v) => !v)}
            className={cn(
              "inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium border transition",
              commentsOnly
                ? "border-accent bg-accent-soft text-ink"
                : "border-line text-ink-muted hover:text-ink hover:border-accent"
            )}
          >
            {t("activityCommentsOnly", locale)}
          </button>
        )}
      </div>
      <ol className="space-y-3" aria-label={t("cardActivity", locale)}>
        {entries.length === 0 && (
          <li className="text-ink-muted">
            {commentsOnly ? t("cardNoComments", locale) : t("activityEmpty", locale)}
          </li>
        )}
        {entries.map((e) =>
          e.kind === "activity" ? (
            <ActivityRow key={`a-${e.id}`} entry={e} locale={locale} onUndo={undoRule} />
          ) : (
            <CommentRow
              key={`c-${e.id}`}
              comment={e}
              locale={locale}
              mentionable={mentionable}
              pending={pending}
              onDelete={() => remove(e.id)}
            />
          )
        )}
      </ol>
      <form
        action={async (fd) => {
          // Offline or connection lost: the draft stays in the box.
          fd.set("clientKey", keyFor(String(fd.get("body") ?? "")));
          const result = await sendOrWarn(ui, () => addCommentAction(fd));
          if (result && ui.report(result).ok) {
            draftKey.current = null;
            setBody("");
            router.refresh();
          }
        }}
        className="space-y-2"
      >
        <input type="hidden" name="cardId" value={cardId} />
        <MentionTextarea
          name="body"
          required
          maxLength={5000}
          rows={3}
          value={body}
          onValueChange={setBody}
          members={members}
          locale={locale}
          aria-label={t("cardWriteComment", locale)}
          placeholder={t("cardWriteComment", locale)}
        />
        <div className="flex flex-wrap items-center gap-3">
          <button className={buttonClass("primary")} disabled={!online} aria-describedby={online ? undefined : `offline-${cardId}`}>
            {t("cardPostComment", locale)}
          </button>
          {!online && (
            <p id={`offline-${cardId}`} className="text-sm text-ink-muted">
              {t("offlineCommentHint", locale)}
            </p>
          )}
        </div>
      </form>
    </div>
  );
}

export function ActivityRow({
  entry,
  locale,
  onUndo,
}: {
  entry: ActivityItem;
  locale: Locale;
  /** Undo for automation rule runs (online only). */
  onUndo?: (runId: string) => void;
}) {
  const [before, after] = describeActivity(entry.type, entry.data, locale);
  // Changes made by an automation rule name the rule, not a person.
  const rule = activityRule(entry.data);
  const actor = rule
    ? t("automationActor", locale).replace("{name}", rule.name)
    : entry.actor
      ? entry.actor.displayName ?? entry.actor.username
      : t("deletedUser", locale);
  return (
    <li className="flex items-start gap-3 text-sm text-ink-muted">
      <span aria-hidden className="w-8 shrink-0 flex justify-center pt-1.5">
        <span className="w-1.5 h-1.5 rounded-full bg-ink-muted" />
      </span>
      <p className="flex-1 min-w-0 break-words">
        {before}
        <span className="font-medium text-ink">{actor}</span>
        {after}
        <span aria-hidden> · </span>
        <RelativeTime iso={entry.createdAt} locale={locale} className="tabular-nums whitespace-nowrap" />
        {onUndo && rule && entry.undoRunId && (
          <>
            {" "}
            <button
              type="button"
              className="font-medium text-accent hover:underline min-h-6"
              aria-label={t("automationUndoNamed", locale).replace("{name}", rule.name)}
              onClick={() => onUndo(entry.undoRunId!)}
            >
              {t("undo", locale)}
            </button>
          </>
        )}
      </p>
    </li>
  );
}

export function CommentRow({
  comment: c,
  locale,
  mentionable,
  pending,
  onDelete,
}: {
  comment: CommentItem;
  locale: Locale;
  mentionable: string[];
  pending: boolean;
  onDelete: () => void;
}) {
  const name = c.author ? c.author.displayName ?? c.author.username : t("deletedUser", locale);
  return (
    <li className="flex gap-3">
      <Avatar src={c.author?.avatarUrl} name={name} size={32} />
      <div className="flex-1 min-w-0 bg-surface border border-line rounded-card p-3">
        <div className="flex items-center justify-between gap-2 text-sm text-ink-muted">
          {c.author ? (
            <Link
              href={`/users/${encodeURIComponent(c.author.username)}`}
              className="hover:underline font-medium text-ink"
            >
              {name}
            </Link>
          ) : (
            <span className="font-medium">{name}</span>
          )}
          <RelativeTime iso={c.createdAt} locale={locale} className="tabular-nums" />
        </div>
        <div
          className="text-md mt-1 max-w-[70ch] [&_a]:break-words [&_a]:text-accent [&_a]:underline [&_a.mention]:text-ink [&_a.mention]:no-underline [&_a.mention:hover]:underline [&_ul]:list-disc [&_ol]:list-decimal [&_ul]:pl-5 [&_ol]:pl-5 [&_p]:my-1 [&_h3]:font-semibold [&_h4]:font-semibold [&_h5]:font-semibold"
          dangerouslySetInnerHTML={{ __html: renderMarkdownToHtml(c.body, { mentions: mentionable }) }}
        />
        {c.canDelete && (
          <button
            type="button"
            disabled={pending}
            onClick={onDelete}
            className={buttonClass("ghost", "sm", "mt-1 -ml-2")}
          >
            {t("delete", locale)}
          </button>
        )}
      </div>
    </li>
  );
}
