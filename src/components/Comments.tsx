"use client";

import { useRef } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import Avatar from "./Avatar";
import { addCommentAction, deleteCommentAction } from "@/server/tasks-actions";
import { t, type Locale, formatDateTime } from "@/lib/i18n";
import { renderMarkdownToHtml } from "@/lib/markdown";

export interface CommentItem {
  id: string;
  body: string;
  createdAt: string;
  author: { id: string; username: string; displayName: string | null; avatarUrl: string | null };
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
  const formRef = useRef<HTMLFormElement>(null);
  return (
    <div className="space-y-4">
      <ul className="space-y-3">
        {comments.length === 0 && (
          <li className="text-sm opacity-60">{t("cardNoComments", locale)}</li>
        )}
        {comments.map((c) => (
          <li key={c.id} className="flex gap-3">
            <Avatar src={c.author.avatarUrl} name={c.author.displayName ?? c.author.username} size={32} />
            <div className="flex-1 surface border rounded-lg p-3">
              <div className="flex items-center justify-between text-xs opacity-70">
                <Link href={`/users/${encodeURIComponent(c.author.username)}`} className="hover:underline font-medium">
                  {c.author.displayName ?? c.author.username}
                </Link>
                <span>{formatDateTime(new Date(c.createdAt), locale)}</span>
              </div>
              <div
                className="text-sm mt-1 [&_a]:break-words [&_ul]:list-disc [&_ol]:list-decimal [&_ul]:pl-5 [&_ol]:pl-5 [&_p]:my-1 [&_h3]:font-semibold [&_h4]:font-semibold [&_h5]:font-semibold"
                dangerouslySetInnerHTML={{ __html: renderMarkdownToHtml(c.body) }}
              />
              {c.canDelete && (
                <form
                  action={async (fd) => {
                    await deleteCommentAction(fd);
                    router.refresh();
                  }}
                  className="mt-2"
                >
                  <input type="hidden" name="commentId" value={c.id} />
                  <button className="text-xs opacity-60 hover:opacity-100">{t("delete", locale)}</button>
                </form>
              )}
            </div>
          </li>
        ))}
      </ul>
      <form
        ref={formRef}
        action={async (fd) => {
          await addCommentAction(fd);
          formRef.current?.reset();
          router.refresh();
        }}
        className="space-y-2"
      >
        <input type="hidden" name="cardId" value={cardId} />
        <textarea
          name="body"
          required
          maxLength={5000}
          rows={3}
          placeholder={t("cardWriteComment", locale)}
        />
        <button className="rounded bg-brand-600 hover:bg-brand-700 text-white text-sm px-3 py-1">
          {t("cardPostComment", locale)}
        </button>
      </form>
    </div>
  );
}
