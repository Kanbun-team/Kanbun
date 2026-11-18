import { prisma } from "@/lib/db-local";
import { LITE_LIMITS, LITE_MAX_CARDS, toOfflineCard, type OfflineBoardCards } from "@/lib/offline-card";

const person = { select: { id: true, username: true, displayName: true, avatarUrl: true } } as const;

/**
 * Lightweight details of the cards of a board, for reading them offline
 * (GET /api/boards/[id]/offline). The caller checks board access. Limits in
 * LITE_LIMITS keep a 500-card board small (see docs/OFFLINE.md).
 */
export async function loadOfflineBoardCards(boardId: string): Promise<OfflineBoardCards | null> {
  const board = await prisma.board.findUnique({
    where: { id: boardId },
    select: {
      id: true,
      members: { where: { user: { deactivatedAt: null } }, select: { user: person } },
      tags: { orderBy: { position: "asc" }, select: { id: true, name: true, color: true } },
    },
  });
  if (!board) return null;
  const renderedAt = new Date().toISOString();
  const cards = await prisma.taskCard.findMany({
    where: { column: { boardId } },
    orderBy: { updatedAt: "desc" },
    take: LITE_MAX_CARDS,
    select: {
      id: true,
      title: true,
      description: true,
      priority: true,
      coverColor: true,
      deadline: true,
      column: { select: { name: true, boardId: true } },
      assignees: { select: { user: person } },
      tags: { select: { tagId: true } },
      subtasks: {
        orderBy: [{ position: "asc" }, { createdAt: "asc" }],
        take: LITE_LIMITS.checklist,
        select: {
          id: true,
          title: true,
          done: true,
          dueDate: true,
          assignee: { select: { username: true, displayName: true } },
        },
      },
      comments: {
        orderBy: { createdAt: "desc" },
        take: LITE_LIMITS.comments,
        select: { id: true, body: true, createdAt: true, author: person },
      },
      attachments: {
        orderBy: { createdAt: "asc" },
        take: LITE_LIMITS.attachments,
        select: {
          id: true,
          fileName: true,
          mimeType: true,
          size: true,
          createdAt: true,
          uploader: { select: { username: true, displayName: true } },
        },
      },
      blocking: { select: { blocked: { select: { id: true, title: true } } } },
      blockedBy: { select: { blocker: { select: { id: true, title: true } } } },
      _count: { select: { comments: true } },
    },
  });
  return {
    boardId,
    renderedAt,
    members: board.members.map((m) => m.user),
    tags: board.tags,
    cards: cards.map((c) =>
      toOfflineCard({ ...c, comments: c.comments.toReversed(), commentsTotal: c._count.comments }, LITE_LIMITS)
    ),
  };
}
