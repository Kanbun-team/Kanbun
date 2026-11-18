"use client";

import { useEffect, useId, useState } from "react";
import { CloudOff, Paperclip } from "lucide-react";
import Avatar from "@/components/Avatar";
import { ActivityRow, CommentRow } from "@/components/Comments";
import { useUi } from "@/components/ui/UiProvider";
import { buttonClass, iconButtonClass } from "@/components/ui/button";
import { formatBytes } from "@/lib/attachments";
import { formatDate, formatDateTime, intlLocale, t, type Locale } from "@/lib/i18n";
import { PRIORITIES, priorityClass, priorityLabel } from "@/lib/labels";
import { renderMarkdownToHtml } from "@/lib/markdown";
import { applyCardOutbox, newerCard, type OfflineCard, type StoredCard } from "@/lib/offline-card";
import { queueEdit, readCard, useOfflineState } from "@/lib/offline-store";
import { COMMENT_PREFIX, newId, type OutboxOp } from "@/lib/outbox";
import { cn } from "@/lib/utils";
import type { CardDTO, MemberOption, TagOption } from "@/components/board/types";

/** What the board knows about a card, used when no details are stored. */
export interface BoardCardFallback {
  card: CardDTO;
  boardId: string;
  columnName: string;
  members: MemberOption[];
  tags: TagOption[];
  renderedAt?: string;
}

function fromBoard(f: BoardCardFallback): StoredCard {
  const card: OfflineCard = {
    id: f.card.id,
    boardId: f.boardId,
    columnName: f.columnName,
    title: f.card.title,
    description: "",
    descriptionTruncated: false,
    priority: f.card.priority,
    coverColor: f.card.coverColor,
    deadline: f.card.deadline,
    assignees: f.card.assignees,
    tagIds: f.card.tags.map((tg) => tg.id),
    checklist: [],
    comments: [],
    commentsTotal: f.card.commentsCount,
    activity: [],
    attachments: [],
    blocking: [],
    blockedBy: [],
  };
  return { card, members: f.members, tags: f.tags, renderedAt: f.renderedAt ?? "", partial: true };
}

// The card read from what this device stored (see docs/OFFLINE.md), shown
// while offline: read-only, except the edits the outbox can queue (title,
// priority, deadline, assignees, tags, checklist items and new comments).
// Mount it with `key={cardId}`.
export default function OfflineCardView({
  boardId,
  cardId,
  userId,
  locale,
  initial,
  fallback,
}: {
  boardId: string;
  cardId: string;
  userId: string;
  locale: Locale;
  /** Details rendered by the server (a full card page served from the offline cache). */
  initial?: StoredCard;
  /** The board's copy of the card, when nothing else is stored. */
  fallback?: BoardCardFallback;
}) {
  const offline = useOfflineState(userId);
  const [stored, setStored] = useState<{ value: StoredCard | undefined } | null>(null);

  useEffect(() => {
    let active = true;
    void readCard(boardId, cardId)
      .catch(() => undefined)
      .then((value) => {
        if (active) setStored({ value });
      });
    return () => {
      active = false;
    };
  }, [boardId, cardId, offline.userId]);

  const best = newerCard(initial, stored?.value);
  const record = best ?? (stored && fallback ? fromBoard(fallback) : undefined);
  const notStored = !best && !!stored;

  if (!record) {
    return stored ? (
      <OfflineNotice locale={locale}>{t("offlineCardNotStored", locale)}</OfflineNotice>
    ) : (
      <p className="text-ink-muted">{t("loading", locale)}</p>
    );
  }

  const own = [...offline.applied.filter((e) => e.op.kind !== "comment"), ...offline.entries].filter(
    (e) => e.boardId === boardId
  );
  const view = applyCardOutbox(record.card, own, offline.idMap);
  return (
    <CardBody
      key={record.renderedAt}
      record={record}
      card={view.card}
      pendingComments={view.pendingComments}
      notStored={notStored}
      locale={locale}
    />
  );
}

function OfflineNotice({ locale, time, children }: { locale: Locale; time?: string; children?: React.ReactNode }) {
  return (
    <div role="status" className="rounded-panel border border-warning/40 bg-surface px-3 py-2 text-sm space-y-1">
      <p className="flex items-center gap-2 font-medium">
        <CloudOff size={16} aria-hidden className="text-warning shrink-0" />
        <span>
          {time
            ? t("offlineCardNotice", locale).replace("{time}", formatDateTime(new Date(time), locale))
            : t("offlineCardNoticeNoTime", locale)}
        </span>
      </p>
      {children && <p className="text-ink-muted">{children}</p>}
    </div>
  );
}

function CardBody({
  record,
  card,
  pendingComments,
  notStored,
  locale,
}: {
  record: StoredCard;
  card: OfflineCard;
  pendingComments: { id: string; body: string; createdAt: string }[];
  notStored: boolean;
  locale: Locale;
}) {
  const ui = useUi();
  const ids = useId();
  const [title, setTitle] = useState(card.title);
  const [comment, setComment] = useState("");
  const nf = intlLocale(locale);
  const boardId = card.boardId;
  const label = card.title;

  function queue(op: OutboxOp) {
    queueEdit(boardId, op, label);
  }

  function saveTitle() {
    const next = title.trim();
    if (!next) return setTitle(card.title);
    if (next !== card.title) queue({ kind: "update", cardId: card.id, fields: { title: next } });
  }

  function postComment() {
    const body = comment.trim();
    if (!body) return;
    queue({ kind: "comment", cardId: card.id, tempId: newId(COMMENT_PREFIX), body: body.slice(0, 5000) });
    setComment("");
    ui.toast({ message: t("offlineCommentQueued", locale) });
  }

  const deadlineDay = card.deadline ? card.deadline.slice(0, 10) : "";
  const done = card.checklist.filter((i) => i.done).length;
  const timeline = [
    ...card.comments.map((c) => ({ kind: "comment" as const, ...c })),
    ...card.activity.map((a) => ({ kind: "activity" as const, ...a })),
  ].sort((a, b) => a.createdAt.localeCompare(b.createdAt));

  return (
    <div className="space-y-6" data-testid="offline-card">
      <OfflineNotice locale={locale} time={record.renderedAt || undefined}>
        {notStored ? t("offlineCardNotStored", locale) : t("offlineCardQueuedHint", locale)}
        {!notStored && record.partial && <> {t("offlineCardPartial", locale)}</>}
      </OfflineNotice>

      <p className="text-sm text-ink-muted">{card.columnName}</p>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          saveTitle();
        }}
      >
        <label htmlFor={`${ids}-title`} className="sr-only">
          {t("cardTitle", locale)}
        </label>
        <h1 className="sr-only">{card.title}</h1>
        <input
          id={`${ids}-title`}
          value={title}
          maxLength={200}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={saveTitle}
          className="w-full !text-xl font-semibold"
        />
      </form>

      <div className="bg-surface border border-line rounded-panel divide-y divide-line">
        <div className="p-4 space-y-2">
          <h2 className="text-sm font-medium text-ink-muted">{t("cardPriority", locale)}</h2>
          <div className="flex flex-wrap gap-1.5">
            {PRIORITIES.map((p) => (
              <button
                key={p}
                type="button"
                aria-pressed={card.priority === p}
                onClick={() => p !== card.priority && queue({ kind: "update", cardId: card.id, fields: { priority: p } })}
                className={pill(card.priority === p)}
              >
                <span aria-hidden="true" className={cn("w-2 h-2 rounded-full shrink-0", priorityClass(p))} />
                {priorityLabel(p, locale)}
              </button>
            ))}
          </div>
        </div>
        <div className="p-4 space-y-2">
          <h2 className="text-sm font-medium text-ink-muted">{t("cardDeadline", locale)}</h2>
          <div className="flex items-center gap-2 flex-wrap">
            <input
              type="date"
              value={deadlineDay}
              aria-label={t("cardDeadline", locale)}
              onChange={(e) =>
                queue({
                  kind: "update",
                  cardId: card.id,
                  fields: { deadline: e.target.value ? `${e.target.value}T00:00:00.000Z` : null },
                })
              }
              className="!py-1 !text-sm w-auto"
            />
            {deadlineDay === "" ? (
              <span className="text-xs text-ink-muted">{t("cardNoDeadline", locale)}</span>
            ) : (
              <button
                type="button"
                onClick={() => queue({ kind: "update", cardId: card.id, fields: { deadline: null } })}
                aria-label={t("remove", locale)}
                title={t("remove", locale)}
                className={iconButtonClass("w-7 h-7 hover:text-danger")}
              >
                &times;
              </button>
            )}
          </div>
        </div>
        <div className="p-4 space-y-2">
          <h2 className="text-sm font-medium text-ink-muted">{t("cardAssignees", locale)}</h2>
          <div className="flex flex-wrap gap-1.5">
            {record.members.length === 0 && <span className="text-sm text-ink-muted">{t("cardNoAssignees", locale)}</span>}
            {record.members.map((m) => {
              const on = card.assignees.some((a) => a.id === m.id);
              return (
                <button
                  key={m.id}
                  type="button"
                  aria-pressed={on}
                  onClick={() => queue({ kind: "assignee", cardId: card.id, user: m, on: !on })}
                  className={pill(on)}
                >
                  <Avatar src={m.avatarUrl} name={m.displayName ?? m.username} size={18} decorative />
                  {m.displayName ?? m.username}
                </button>
              );
            })}
          </div>
        </div>
        <div className="p-4 space-y-2">
          <h2 className="text-sm font-medium text-ink-muted">{t("cardTags", locale)}</h2>
          <div className="flex flex-wrap gap-1.5">
            {record.tags.length === 0 && <span className="text-sm text-ink-muted">{t("cardNoTags", locale)}</span>}
            {record.tags.map((tag) => {
              const on = card.tagIds.includes(tag.id);
              return (
                <button
                  key={tag.id}
                  type="button"
                  aria-pressed={on}
                  onClick={() => queue({ kind: "tag", cardId: card.id, tag, on: !on })}
                  className={pill(on)}
                >
                  <span aria-hidden className="w-2 h-2 rounded-full shrink-0" style={{ background: tag.color }} />
                  {tag.name}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      <section>
        <h2 className="text-md font-semibold mb-2">{t("cardDescription", locale)}</h2>
        {card.description ? (
          <div
            className="text-md max-w-[70ch] [&_a]:text-accent [&_a]:underline [&_ul]:list-disc [&_ol]:list-decimal [&_ul]:pl-5 [&_ol]:pl-5 [&_p]:my-1"
            dangerouslySetInnerHTML={{ __html: renderMarkdownToHtml(card.description) }}
          />
        ) : (
          <p className="text-ink-muted">{t("none", locale)}</p>
        )}
      </section>

      <section>
        <h2 className="text-md font-semibold mb-2">
          {t("cardSubtasks", locale)}
          {card.checklist.length > 0 && (
            <span className="ml-2 text-sm font-normal text-ink-muted tabular-nums">
              {done}/{card.checklist.length}
            </span>
          )}
        </h2>
        {card.checklist.length === 0 ? (
          <p className="text-ink-muted">{t("cardNoSubtasks", locale)}</p>
        ) : (
          <ul className="space-y-1">
            {card.checklist.map((item) => (
              <li key={item.id} className="flex items-center gap-2 min-h-8">
                <input
                  type="checkbox"
                  id={`${ids}-sub-${item.id}`}
                  checked={item.done}
                  onChange={(e) =>
                    queue({ kind: "subtask", cardId: card.id, subtaskId: item.id, done: e.target.checked })
                  }
                  aria-label={t("subtaskToggle", locale).replace("{title}", item.title)}
                  className="w-5 h-5 shrink-0"
                />
                <span className={cn("flex-1 min-w-0 break-words", item.done && "line-through text-ink-muted")}>
                  {item.title}
                </span>
                {(item.assigneeName || item.dueDate) && (
                  <span className="text-xs text-ink-muted">
                    {[item.assigneeName, item.dueDate && formatDate(new Date(`${item.dueDate}T00:00:00`), locale)]
                      .filter(Boolean)
                      .join(", ")}
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2 className="text-md font-semibold mb-2">{t("cardAttachments", locale)}</h2>
        {card.attachments.length === 0 ? (
          <p className="text-ink-muted">{t("attachmentsEmpty", locale)}</p>
        ) : (
          <ul aria-label={t("attachmentFiles", locale)} className="space-y-2">
            {card.attachments.map((a) => (
              <li key={a.id} className="flex items-center gap-3 rounded-card border border-line bg-surface p-2">
                {a.mimeType.startsWith("image/") ? <CachedThumb id={a.id} /> : <Paperclip size={16} aria-hidden className="text-ink-muted shrink-0" />}
                <span className="flex-1 min-w-0">
                  <span className="block truncate">{a.fileName}</span>
                  <span className="block text-xs text-ink-muted">
                    {[formatBytes(a.size, nf), a.uploaderName && t("attachmentAddedBy", locale).replace("{name}", a.uploaderName)]
                      .filter(Boolean)
                      .join(", ")}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {(card.blocking.length > 0 || card.blockedBy.length > 0) && (
        <section className="space-y-2">
          <h2 className="text-md font-semibold">{t("cardDependencies", locale)}</h2>
          {card.blockedBy.length > 0 && (
            <div>
              <h3 className="text-sm font-medium text-ink-muted">{t("cardBlockedBy", locale)}</h3>
              <ul className="list-disc pl-5">
                {card.blockedBy.map((b) => (
                  <li key={b.cardId}>{b.title}</li>
                ))}
              </ul>
            </div>
          )}
          {card.blocking.length > 0 && (
            <div>
              <h3 className="text-sm font-medium text-ink-muted">{t("cardBlocking", locale)}</h3>
              <ul className="list-disc pl-5">
                {card.blocking.map((b) => (
                  <li key={b.cardId}>{b.title}</li>
                ))}
              </ul>
            </div>
          )}
        </section>
      )}

      <section className="space-y-4">
        <h2 className="text-md font-semibold">{t("cardActivity", locale)}</h2>
        <ol className="space-y-3" aria-label={t("cardActivity", locale)}>
          {timeline.length === 0 && pendingComments.length === 0 && (
            <li className="text-ink-muted">{t("activityEmpty", locale)}</li>
          )}
          {timeline.map((e) =>
            e.kind === "activity" ? (
              <ActivityRow key={`a-${e.id}`} entry={e} locale={locale} />
            ) : (
              <CommentRow
                key={`c-${e.id}`}
                comment={{ ...e, canDelete: false }}
                locale={locale}
                mentionable={[]}
                pending={false}
                onDelete={() => {}}
              />
            )
          )}
          {pendingComments.map((c) => (
            <li key={c.id} className="flex gap-3" data-testid="pending-comment">
              <span aria-hidden className="w-8 shrink-0" />
              <div className="flex-1 min-w-0 bg-surface border border-dashed border-line-strong rounded-card p-3">
                <p className="text-sm text-ink-muted font-medium">{t("offlineCommentPending", locale)}</p>
                <p className="text-md mt-1 whitespace-pre-wrap break-words">{c.body}</p>
              </div>
            </li>
          ))}
        </ol>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            postComment();
          }}
          className="space-y-2"
        >
          <textarea
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            rows={3}
            maxLength={5000}
            required
            aria-label={t("cardWriteComment", locale)}
            placeholder={t("cardWriteComment", locale)}
            className="w-full"
          />
          <button className={buttonClass("primary")}>{t("cardPostComment", locale)}</button>
        </form>
      </section>
    </div>
  );
}

function pill(active: boolean) {
  return cn(
    "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 min-h-6 text-xs font-medium border transition",
    active ? "border-accent bg-accent-soft text-ink" : "border-line text-ink-muted hover:text-ink hover:border-accent"
  );
}

/**
 * An image attachment, only if the browser still has it from viewing it
 * online (the attachment route allows private caching for an hour). Nothing
 * is fetched or stored for offline use.
 */
function CachedThumb({ id }: { id: string }) {
  const [failed, setFailed] = useState(false);
  if (failed) return <Paperclip size={16} aria-hidden className="text-ink-muted shrink-0" />;
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={`/api/attachments/${id}`}
      alt=""
      width={40}
      height={40}
      loading="lazy"
      onError={() => setFailed(true)}
      className="w-10 h-10 rounded object-cover shrink-0"
    />
  );
}
