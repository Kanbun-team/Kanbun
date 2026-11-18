import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db-local";
import { requirePageUser } from "@/auth";
import { getLocale } from "@/lib/get-locale";
import ActionForm from "@/components/ui/ActionForm";
import { buttonClass } from "@/components/ui/button";
import { t } from "@/lib/i18n";
import { canManageBoard, loadBoardAccess } from "@/server/board-access";
import {
  CardAssignees,
  CardCover,
  CardDeadlineEditor,
  CardDescriptionEditor,
  CardPriorityEditor,
  CardTitleEditor,
} from "@/components/CardEditor";
import SubtaskList from "@/components/SubtaskList";
import { CardBlocks, CardTags } from "@/components/CardTagsBlocks";
import Comments from "@/components/Comments";
import { deleteCardAction } from "@/server/tasks-actions";
import { parseMentions } from "@/lib/notifications";
import { parseActivityData } from "@/lib/activity";

// The card view, shared by the full page (/tasks/[id]/cards/[cardId]) and the
// side panel that opens over the board. In the panel the layout is a single
// column and the panel header provides the way back.
export default async function CardDetail({
  boardId,
  cardId,
  variant,
}: {
  boardId: string;
  cardId: string;
  variant: "page" | "panel";
}) {
  const panel = variant === "panel";
  const me = await requirePageUser();
  let access;
  try {
    access = await loadBoardAccess(boardId);
  } catch {
    notFound();
  }
  const locale = await getLocale();

  const card = await prisma.taskCard.findUnique({
    where: { id: cardId },
    include: {
      column: { select: { name: true, boardId: true } },
      assignees: {
        include: { user: { select: { id: true, username: true, displayName: true, avatarUrl: true } } },
      },
      tags: { select: { tagId: true } },
      subtasks: { orderBy: { position: "asc" } },
      comments: {
        orderBy: { createdAt: "asc" },
        include: { author: { select: { id: true, username: true, displayName: true, avatarUrl: true } } },
      },
      blocking: {
        include: {
          blocked: { select: { id: true, title: true } },
        },
      },
      blockedBy: {
        include: {
          blocker: { select: { id: true, title: true } },
        },
      },
    },
  });
  if (!card || card.column.boardId !== boardId) notFound();

  const board = await prisma.board.findUnique({
    where: { id: boardId },
    include: {
      members: {
        where: { user: { deactivatedAt: null } },
        include: { user: { select: { id: true, username: true, displayName: true, avatarUrl: true } } },
      },
      tags: { orderBy: { position: "asc" } },
      columns: {
        orderBy: { position: "asc" },
        include: { cards: { orderBy: { position: "asc" }, select: { id: true, title: true } } },
      },
    },
  });
  if (!board) notFound();

  const allCards = board.columns.flatMap((c) =>
    c.cards.map((cc) => ({ id: cc.id, title: cc.title, columnName: c.name }))
  );
  const linkedIds = new Set([
    card.id,
    ...card.blocking.map((b) => b.blocked.id),
    ...card.blockedBy.map((b) => b.blocker.id),
  ]);
  const candidates = allCards.filter((c) => !linkedIds.has(c.id));
  const canManage = canManageBoard(access);

  const [recentActivity, mentionedUsers] = await Promise.all([
    // The newest 300 entries; the timeline shows them oldest first.
    prisma.cardActivity.findMany({
      where: { cardId: card.id },
      orderBy: { createdAt: "desc" },
      take: 300,
      include: { actor: { select: { username: true, displayName: true } } },
    }),
    // Only names of real accounts are highlighted as mentions.
    prisma.user.findMany({
      where: { username: { in: [...new Set(card.comments.flatMap((c) => parseMentions(c.body)))] } },
      select: { username: true },
    }),
  ]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-2">
        {panel ? (
          <span className="text-sm text-ink-muted">
            {board.name}, {card.column.name}
          </span>
        ) : (
          <Link href={`/tasks/${boardId}`} className="text-sm text-ink-muted hover:text-ink">
            &larr; {board.name}, {card.column.name}
          </Link>
        )}
        <ActionForm action={deleteCardAction} undo success={t("cardDeleted", locale)} redirectTo={`/tasks/${boardId}`}>
          <input type="hidden" name="cardId" value={card.id} />
          <button className={buttonClass("ghost", "sm", "text-danger hover:text-danger")}>{t("cardDelete", locale)}</button>
        </ActionForm>
      </div>

      <CardTitleEditor cardId={card.id} initialTitle={card.title} locale={locale} />

      <div className={panel ? "grid gap-6" : "grid lg:grid-cols-3 gap-6"}>
        <div className={panel ? "space-y-6 order-2" : "lg:col-span-2 space-y-6"}>
          <section>
            <h2 className="text-md font-semibold mb-2">
              {t("cardDescription", locale)}
            </h2>
            <CardDescriptionEditor
              cardId={card.id}
              initialDescription={card.description ?? ""}
              locale={locale}
            />
          </section>

          <section>
            <h2 className="text-md font-semibold mb-2">
              {t("cardSubtasks", locale)}
            </h2>
            <SubtaskList
              cardId={card.id}
              subtasks={card.subtasks.map((s) => ({ id: s.id, title: s.title, done: s.done }))}
              locale={locale}
            />
          </section>

          <section>
            <Comments
              cardId={card.id}
              locale={locale}
              comments={card.comments.map((c) => ({
                id: c.id,
                body: c.body,
                createdAt: c.createdAt.toISOString(),
                author: c.author,
                canDelete: c.authorId === me.id || canManage,
              }))}
              activity={recentActivity.toReversed().map((a) => ({
                id: a.id,
                type: a.type,
                data: parseActivityData(a.data),
                createdAt: a.createdAt.toISOString(),
                actor: a.actor,
              }))}
              members={board.members.map((m) => m.user)}
              mentionable={mentionedUsers.map((u) => u.username)}
            />
          </section>
        </div>

        <aside className={panel ? "space-y-4 order-1" : "space-y-4"}>
          <div className="bg-surface border border-line rounded-panel divide-y divide-line">
            <div className="p-4 space-y-2">
              <h3 className="text-sm font-medium text-ink-muted">{t("cardPriority", locale)}</h3>
              <CardPriorityEditor cardId={card.id} initialPriority={card.priority} locale={locale} />
            </div>
            <div className="p-4 space-y-2">
              <h3 className="text-sm font-medium text-ink-muted">{t("cardDeadline", locale)}</h3>
              <CardDeadlineEditor
                cardId={card.id}
                initialDeadline={card.deadline ? card.deadline.toISOString() : null}
                locale={locale}
              />
            </div>
            <div className="p-4 space-y-2">
              <h3 className="text-sm font-medium text-ink-muted">{t("cardAssignees", locale)}</h3>
              <CardAssignees
                cardId={card.id}
                locale={locale}
                assignees={card.assignees.map((a) => a.user)}
                members={board.members.map((m) => m.user)}
              />
            </div>
            <div className="p-4 space-y-2">
              <h3 className="text-sm font-medium text-ink-muted">{t("cardCover", locale)}</h3>
              <CardCover cardId={card.id} initialColor={card.coverColor} locale={locale} />
            </div>
            <div className="p-4 space-y-2">
              <h3 className="text-sm font-medium text-ink-muted">{t("cardTags", locale)}</h3>
              <CardTags
                cardId={card.id}
                boardTags={board.tags.map((tt) => ({ id: tt.id, name: tt.name, color: tt.color }))}
                selectedTagIds={card.tags.map((tt) => tt.tagId)}
                locale={locale}
              />
            </div>
          </div>
          <section>
            <h3 className="text-md font-semibold mb-2">{t("cardDependencies", locale)}</h3>
            <CardBlocks
              boardId={boardId}
              cardId={card.id}
              blocking={card.blocking.map((b) => ({
                blockId: b.id,
                cardId: b.blocked.id,
                cardTitle: b.blocked.title,
              }))}
              blockedBy={card.blockedBy.map((b) => ({
                blockId: b.id,
                cardId: b.blocker.id,
                cardTitle: b.blocker.title,
              }))}
              candidates={candidates}
              locale={locale}
            />
          </section>
        </aside>
      </div>
    </div>
  );
}
