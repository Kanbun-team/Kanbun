"use client";

import { useRef, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import Avatar from "./Avatar";
import { addCommentAction, deleteCommentAction } from "@/server/tasks-actions";
import { t, type Locale, formatDateTime } from "@/lib/i18n";
import { renderMarkdownToHtml } from "@/lib/markdown";
import { useUi } from "./ui/UiProvider";
import { buttonClass } from "./ui/button";

export interface CommentItem {
  id: string;
  body: string;
  createdAt: string;
  /** Null when the author's account was deleted. */
  author: { id: string; username: string; displayName: string | null; avatarUrl: string | null } | null;
  canDelete: boolean;
}

export default function Comments({
  cardId,
  comments,
  locale,
}: {
  cardId: string;
  comments: CommentItem[];
  locale: Locale;
}) {
  const router = useRouter();
  const ui = useUi();
  const formRef = useRef<HTMLFormElement>(null);
  const [pending, startTransition] = useTransition();

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
      <ul className="space-y-3">
        {comments.length === 0 && <li className="text-ink-muted">{t("cardNoComments", locale)}</li>}
        {comments.map((c) => {
          const name = c.author ? c.author.displayName ?? c.author.username : t("deletedUser", locale);
          return (
            <li key={c.id} className="flex gap-3">
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
                  <span className="tabular-nums">{formatDateTime(new Date(c.createdAt), locale)}</span>
                </div>
                <div
                  className="text-md mt-1 max-w-[70ch] [&_a]:break-words [&_a]:text-accent [&_a]:underline [&_ul]:list-disc [&_ol]:list-decimal [&_ul]:pl-5 [&_ol]:pl-5 [&_p]:my-1 [&_h3]:font-semibold [&_h4]:font-semibold [&_h5]:font-semibold"
                  dangerouslySetInnerHTML={{ __html: renderMarkdownToHtml(c.body) }}
                />
                {c.canDelete && (
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => remove(c.id)}
                    className={buttonClass("ghost", "sm", "mt-1 -ml-2")}
                  >
                    {t("delete", locale)}
                  </button>
                )}
              </div>
            </li>
          );
        })}
      </ul>
      <form
        ref={formRef}
        action={async (fd) => {
          if (ui.report(await addCommentAction(fd)).ok) {
            formRef.current?.reset();
            router.refresh();
          }
        }}
        className="space-y-2"
      >
        <input type="hidden" name="cardId" value={cardId} />
        <textarea
          name="body"
          required
          maxLength={5000}
          rows={3}
          aria-label={t("cardWriteComment", locale)}
          placeholder={t("cardWriteComment", locale)}
        />
        <button className={buttonClass("primary")}>{t("cardPostComment", locale)}</button>
      </form>
    </div>
  );
}
