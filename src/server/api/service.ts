// What the REST API does, resource by resource. Mirrors the server actions in
// src/server/tasks-actions.ts (same permission rules, card history, watchers,
// notifications, trash, live board updates) for a user known from a token
// instead of the session, and emits the webhook events.

import { z } from "zod";
import { revalidatePath } from "next/cache";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db-local";
import { PRIORITIES } from "@/lib/labels";
import { publishBoard } from "@/lib/realtime";
import { notify } from "@/lib/notifications";
import { canManageBoard, resolveBoardAccess, type BoardAccess } from "@/server/board-access";
import { logActivity, type ActivityEntry } from "@/server/activity";
import { notifyComment, notifyMoved, notifyNewCards, watchCard } from "@/server/watchers";
import { trashCard, trashColumn } from "@/server/trash";
import { changedFields, emitBoardEvent, emitColumnCardsDeleted } from "@/server/webhooks";
import { ApiError, notFound, type ApiContext, type PageParams } from "./http";
import { CommentKeyError, createCommentOnce, parseClientKey } from "@/server/comments";
import {
  boardJson,
  cardInclude,
  cardJson,
  columnJson,
  commentInclude,
  commentJson,
  tagJson,
} from "./serialize";

type Tx = Prisma.TransactionClient;

const actorName = (ctx: ApiContext) => ctx.user.displayName ?? ctx.user.username;

function access(ctx: ApiContext, boardId: string): Promise<BoardAccess> {
  return resolveBoardAccess({ id: ctx.user.id, role: ctx.user.role }, boardId);
}

function requireManage(a: BoardAccess): void {
  if (!canManageBoard(a)) throw new ApiError(403, "forbidden", "Only board owners and admins can do that.");
}

function refresh(boardId: string, cardId?: string): void {
  revalidatePath(`/tasks/${boardId}`);
  if (cardId) revalidatePath(`/tasks/${boardId}/cards/${cardId}`);
  publishBoard(boardId);
}

// "YYYY-MM-DD" or an ISO date-time; stored as UTC midnight like the UI does.
const deadlineSchema = z
  .union([z.string().regex(/^\d{4}-\d{2}-\d{2}(T.*)?$/, "Use YYYY-MM-DD"), z.null()])
  .transform((v, ctx) => {
    if (v === null) return null;
    const d = new Date(v.length === 10 ? `${v}T00:00:00.000Z` : v);
    if (Number.isNaN(d.getTime())) {
      ctx.addIssue({ code: "custom", message: "Invalid date" });
      return z.NEVER;
    }
    return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  });

const idList = z.array(z.string().min(1)).max(50).transform((ids) => [...new Set(ids)]);

// ---------------------------------------------------------------------------
// Boards, columns, tags
// ---------------------------------------------------------------------------

export async function listBoards(ctx: ApiContext, page: PageParams) {
  const rows = await prisma.board.findMany({
    where: ctx.user.role === "admin" ? {} : { members: { some: { userId: ctx.user.id } } },
    orderBy: [{ position: "asc" }, { createdAt: "asc" }],
    skip: page.skip,
    take: page.take + 1,
  });
  return rows.map(boardJson);
}

export async function getBoard(ctx: ApiContext, boardId: string) {
  await access(ctx, boardId);
  const board = await prisma.board.findUnique({
    where: { id: boardId },
    include: { columns: { orderBy: { position: "asc" } }, tags: { orderBy: { position: "asc" } } },
  });
  if (!board) throw notFound("Board");
  return { ...boardJson(board), columns: board.columns.map(columnJson), tags: board.tags.map(tagJson) };
}

export async function listColumns(ctx: ApiContext, boardId: string) {
  await access(ctx, boardId);
  const cols = await prisma.boardColumn.findMany({ where: { boardId }, orderBy: { position: "asc" } });
  return { data: cols.map(columnJson) };
}

export async function listTags(ctx: ApiContext, boardId: string) {
  await access(ctx, boardId);
  const tags = await prisma.boardTag.findMany({ where: { boardId }, orderBy: { position: "asc" } });
  return { data: tags.map(tagJson) };
}

const columnCreateSchema = z.object({
  name: z.string().trim().min(1).max(80),
  wipLimit: z.number().int().min(1).max(999).nullable().optional(),
});

export async function createColumn(ctx: ApiContext, boardId: string, body: unknown) {
  const data = columnCreateSchema.parse(body);
  await access(ctx, boardId);
  const last = await prisma.boardColumn.findFirst({
    where: { boardId },
    orderBy: { position: "desc" },
    select: { position: true },
  });
  const col = await prisma.boardColumn.create({
    data: { boardId, name: data.name, wipLimit: data.wipLimit ?? null, position: (last?.position ?? -1) + 1 },
  });
  refresh(boardId);
  return columnJson(col);
}

const columnUpdateSchema = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  wipLimit: z.number().int().min(1).max(999).nullable().optional(),
  position: z.number().int().min(0).optional(),
});

export async function updateColumn(ctx: ApiContext, columnId: string, body: unknown) {
  const data = columnUpdateSchema.parse(body);
  const col = await prisma.boardColumn.findUnique({ where: { id: columnId }, select: { boardId: true } });
  if (!col) throw notFound("Column");
  const a = await access(ctx, col.boardId);
  // Reordering columns is for board owners, like in the UI.
  if (data.position !== undefined) requireManage(a);
  await prisma.$transaction(async (tx) => {
    if (data.name !== undefined || data.wipLimit !== undefined) {
      await tx.boardColumn.update({ where: { id: columnId }, data: { name: data.name, wipLimit: data.wipLimit } });
    }
    if (data.position !== undefined) {
      const cols = await tx.boardColumn.findMany({
        where: { boardId: col.boardId },
        orderBy: { position: "asc" },
        select: { id: true },
      });
      const ids = cols.map((c) => c.id).filter((id) => id !== columnId);
      ids.splice(Math.min(data.position, ids.length), 0, columnId);
      await Promise.all(ids.map((id, idx) => tx.boardColumn.update({ where: { id }, data: { position: idx } })));
    }
  });
  refresh(col.boardId);
  return columnJson(await prisma.boardColumn.findUniqueOrThrow({ where: { id: columnId } }));
}

export async function deleteColumn(ctx: ApiContext, columnId: string) {
  const col = await prisma.boardColumn.findUnique({
    where: { id: columnId },
    select: { boardId: true, name: true, cards: { select: { id: true } } },
  });
  if (!col) throw notFound("Column");
  requireManage(await access(ctx, col.boardId));
  const trashId = await trashColumn(columnId, ctx.user.id);
  refresh(col.boardId);
  emitColumnCardsDeleted(col.boardId, { id: columnId, name: col.name }, col.cards.map((c) => c.id), trashId, ctx.user.id);
  return { id: columnId, trashId };
}

// ---------------------------------------------------------------------------
// Cards
// ---------------------------------------------------------------------------

const listQuerySchema = z.object({
  column: z.string().min(1).optional(),
  assignee: z.string().min(1).optional(),
  tag: z.string().min(1).optional(),
  updatedSince: z
    .string()
    .optional()
    .transform((v, c) => {
      if (v === undefined) return undefined;
      const d = new Date(v);
      if (Number.isNaN(d.getTime())) {
        c.addIssue({ code: "custom", message: "updatedSince must be an ISO 8601 date-time" });
        return z.NEVER;
      }
      return d;
    }),
});

export async function listCards(ctx: ApiContext, boardId: string, query: URLSearchParams, page: PageParams) {
  const q = listQuerySchema.parse({
    column: query.get("column") ?? undefined,
    assignee: query.get("assignee") ?? undefined,
    tag: query.get("tag") ?? undefined,
    updatedSince: query.get("updatedSince") ?? undefined,
  });
  await access(ctx, boardId);
  const where: Prisma.TaskCardWhereInput = { column: { boardId } };
  if (q.column) where.columnId = q.column;
  if (q.assignee) {
    where.assignees = { some: { user: { OR: [{ id: q.assignee }, { username: q.assignee.toLowerCase() }] } } };
  }
  if (q.tag) where.tags = { some: { tag: { boardId, OR: [{ id: q.tag }, { name: q.tag }] } } };
  if (q.updatedSince) where.updatedAt = { gte: q.updatedSince };
  const rows = await prisma.taskCard.findMany({
    where,
    include: cardInclude,
    orderBy: [{ column: { position: "asc" } }, { position: "asc" }, { id: "asc" }],
    skip: page.skip,
    take: page.take + 1,
  });
  return rows.map(cardJson);
}

async function loadCard(ctx: ApiContext, cardId: string) {
  const card = await prisma.taskCard.findUnique({ where: { id: cardId }, include: cardInclude });
  if (!card) throw notFound("Card");
  const a = await access(ctx, card.column.boardId);
  return { card, access: a };
}

export async function getCard(ctx: ApiContext, cardId: string) {
  return cardJson((await loadCard(ctx, cardId)).card);
}

/** Puts a card at `position` (clamped) in `columnId` and renumbers that column. */
async function placeCard(tx: Tx, cardId: string, columnId: string, position: number | undefined) {
  const others = await tx.taskCard.findMany({
    where: { columnId, id: { not: cardId } },
    orderBy: { position: "asc" },
    select: { id: true },
  });
  const ids = others.map((c) => c.id);
  const at = position === undefined ? ids.length : Math.max(0, Math.min(position, ids.length));
  ids.splice(at, 0, cardId);
  await tx.taskCard.update({ where: { id: cardId }, data: { columnId } });
  await Promise.all(ids.map((id, idx) => tx.taskCard.update({ where: { id }, data: { position: idx } })));
}

/** Assignees must be active members of the board, tags must belong to it. */
async function checkRefs(boardId: string, assigneeIds?: string[], tagIds?: string[]) {
  const users = new Map<string, string>();
  if (assigneeIds?.length) {
    const members = await prisma.boardMember.findMany({
      where: { boardId, userId: { in: assigneeIds }, user: { deactivatedAt: null } },
      select: { userId: true, user: { select: { username: true, displayName: true } } },
    });
    for (const m of members) users.set(m.userId, m.user.displayName ?? m.user.username);
    const missing = assigneeIds.filter((id) => !users.has(id));
    if (missing.length) {
      throw new ApiError(422, "validation_failed", "Assignees must be active members of the board.", {
        assigneeIds: missing,
      });
    }
  }
  const tags = new Map<string, string>();
  if (tagIds?.length) {
    const rows = await prisma.boardTag.findMany({ where: { boardId, id: { in: tagIds } }, select: { id: true, name: true } });
    for (const t of rows) tags.set(t.id, t.name);
    const missing = tagIds.filter((id) => !tags.has(id));
    if (missing.length) throw new ApiError(422, "validation_failed", "Unknown tags for this board.", { tagIds: missing });
  }
  return { users, tags };
}

const cardCreateSchema = z.object({
  columnId: z.string().min(1),
  title: z.string().trim().min(1).max(200),
  description: z.string().max(20_000).nullable().optional(),
  priority: z.enum(PRIORITIES).optional(),
  deadline: deadlineSchema.optional(),
  position: z.number().int().min(0).optional(),
  assigneeIds: idList.optional(),
  tagIds: idList.optional(),
});

export async function createCard(ctx: ApiContext, boardId: string, body: unknown) {
  const data = cardCreateSchema.parse(body);
  await access(ctx, boardId);
  const col = await prisma.boardColumn.findUnique({ where: { id: data.columnId }, select: { boardId: true, name: true } });
  if (!col || col.boardId !== boardId) {
    throw new ApiError(422, "validation_failed", "columnId is not a column of this board.");
  }
  const refs = await checkRefs(boardId, data.assigneeIds, data.tagIds);
  const userId = ctx.user.id;

  const card = await prisma.$transaction(async (tx) => {
    const created = await tx.taskCard.create({
      data: {
        columnId: data.columnId,
        title: data.title,
        description: data.description?.trim() || null,
        priority: data.priority ?? "normal",
        deadline: data.deadline ?? null,
        position: 0,
        createdById: userId,
        assignees: { create: [...refs.users.keys()].map((id) => ({ userId: id })) },
        tags: { create: [...refs.tags.keys()].map((id) => ({ tagId: id })) },
      },
    });
    await placeCard(tx, created.id, data.columnId, data.position);
    await watchCard(created.id, userId, tx);
    for (const id of refs.users.keys()) await watchCard(created.id, id, tx);
    await tx.taskCardMoveEvent.create({
      data: { cardId: created.id, cardTitle: created.title, boardId, toColumnName: col.name, userId },
    });
    await logActivity({ cardId: created.id, boardId, actorId: userId, type: "created", data: { column: col.name, columnId: data.columnId } }, tx);
    return created;
  });

  const actor = { id: userId, name: actorName(ctx) };
  await notifyNewCards(boardId, [{ id: card.id, title: card.title }], actor);
  for (const id of refs.users.keys()) {
    await notify({ recipientId: id, type: "assigned", cardId: card.id, cardTitle: card.title, boardId, actorId: userId, actorName: actor.name });
  }
  refresh(boardId);
  emitBoardEvent(boardId, "card.created", { cardId: card.id, actorId: userId });
  return cardJson(await prisma.taskCard.findUniqueOrThrow({ where: { id: card.id }, include: cardInclude }));
}

const cardUpdateSchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  description: z.string().max(20_000).nullable().optional(),
  priority: z.enum(PRIORITIES).optional(),
  deadline: deadlineSchema.optional(),
  columnId: z.string().min(1).optional(),
  position: z.number().int().min(0).optional(),
  assigneeIds: idList.optional(),
  tagIds: idList.optional(),
});

export async function updateCard(ctx: ApiContext, cardId: string, body: unknown) {
  const data = cardUpdateSchema.parse(body);
  const { card } = await loadCard(ctx, cardId);
  const boardId = card.column.boardId;
  const userId = ctx.user.id;

  let toColumn: { id: string; name: string } | null = null;
  const fromColumn = await prisma.boardColumn.findUniqueOrThrow({ where: { id: card.columnId }, select: { name: true } });
  if (data.columnId !== undefined && data.columnId !== card.columnId) {
    const col = await prisma.boardColumn.findUnique({ where: { id: data.columnId }, select: { id: true, boardId: true, name: true } });
    if (!col || col.boardId !== boardId) {
      throw new ApiError(422, "validation_failed", "columnId is not a column of this card's board.");
    }
    toColumn = col;
  }
  const refs = await checkRefs(boardId, data.assigneeIds, data.tagIds);

  const base = { cardId, boardId, actorId: userId };
  const activity: ActivityEntry[] = [];
  const fields: Prisma.TaskCardUpdateInput = {};
  if (data.title !== undefined && data.title !== card.title) {
    fields.title = data.title;
    activity.push({ ...base, type: "renamed", data: { from: card.title, to: data.title } });
  }
  if (data.priority !== undefined && data.priority !== card.priority) {
    fields.priority = data.priority;
    activity.push({ ...base, type: "priority", data: { from: card.priority, to: data.priority } });
  }
  if (data.deadline !== undefined && (data.deadline?.getTime() ?? null) !== (card.deadline?.getTime() ?? null)) {
    fields.deadline = data.deadline;
    activity.push({ ...base, type: "deadline", data: { to: data.deadline ? data.deadline.toISOString() : null } });
  }
  if (data.description !== undefined) {
    const next = data.description?.trim() || null;
    if (next !== (card.description || null)) {
      fields.description = next;
      activity.push({ ...base, type: "description", data: {} });
    }
  }

  const currentUsers = new Map(card.assignees.map((a) => [a.user.id, a.user.displayName ?? a.user.username]));
  const addUsers = data.assigneeIds ? data.assigneeIds.filter((id) => !currentUsers.has(id)) : [];
  const dropUsers = data.assigneeIds ? [...currentUsers.keys()].filter((id) => !data.assigneeIds!.includes(id)) : [];
  for (const id of addUsers) activity.push({ ...base, type: "assigneeAdded", data: { name: refs.users.get(id) ?? "" } });
  for (const id of dropUsers) activity.push({ ...base, type: "assigneeRemoved", data: { name: currentUsers.get(id) ?? "" } });

  const currentTags = new Map(card.tags.map((t) => [t.tag.id, t.tag.name]));
  const addTags = data.tagIds ? data.tagIds.filter((id) => !currentTags.has(id)) : [];
  const dropTags = data.tagIds ? [...currentTags.keys()].filter((id) => !data.tagIds!.includes(id)) : [];
  for (const id of addTags) activity.push({ ...base, type: "tagAdded", data: { name: refs.tags.get(id) ?? "" } });
  for (const id of dropTags) activity.push({ ...base, type: "tagRemoved", data: { name: currentTags.get(id) ?? "" } });

  const moving = toColumn !== null || data.position !== undefined;
  if (toColumn) activity.push({ ...base, type: "moved", data: { from: fromColumn.name, to: toColumn.name, fromId: card.columnId, toId: toColumn.id } });

  await prisma.$transaction(async (tx) => {
    if (Object.keys(fields).length) await tx.taskCard.update({ where: { id: cardId }, data: fields });
    if (dropUsers.length) await tx.taskCardAssignee.deleteMany({ where: { cardId, userId: { in: dropUsers } } });
    for (const id of addUsers) {
      await tx.taskCardAssignee.create({ data: { cardId, userId: id } });
      await watchCard(cardId, id, tx);
    }
    if (dropTags.length) await tx.taskCardTag.deleteMany({ where: { cardId, tagId: { in: dropTags } } });
    for (const id of addTags) await tx.taskCardTag.create({ data: { cardId, tagId: id } });
    if (moving) await placeCard(tx, cardId, toColumn?.id ?? card.columnId, data.position ?? (toColumn ? undefined : card.position));
    if (toColumn) {
      await tx.taskCardMoveEvent.create({
        data: { cardId, cardTitle: card.title, boardId, fromColumnName: fromColumn.name, toColumnName: toColumn.name, userId },
      });
    }
    // Assignee, tag and move changes do not touch the card row itself.
    if (!Object.keys(fields).length && activity.length) {
      await tx.taskCard.update({ where: { id: cardId }, data: { updatedAt: new Date() } });
    }
    await logActivity(activity, tx);
  });

  const title = (fields.title as string | undefined) ?? card.title;
  for (const id of addUsers) {
    await notify({ recipientId: id, type: "assigned", cardId, cardTitle: title, boardId, actorId: userId, actorName: actorName(ctx) });
  }
  if (toColumn) await notifyMoved({ cardId, cardTitle: title, boardId, actorId: userId, actorName: actorName(ctx), toColumnName: toColumn.name });

  refresh(boardId, cardId);
  // card.moved means another column; a new position within the same column
  // is reported as card.updated with "position" in changes.
  const changes = changedFields(activity);
  if (moving && !toColumn && data.position !== card.position) changes.push("position");
  if (changes.length) emitBoardEvent(boardId, "card.updated", { cardId, actorId: userId, extra: { changes } });
  if (toColumn) {
    emitBoardEvent(boardId, "card.moved", {
      cardId,
      actorId: userId,
      extra: {
        from: { columnId: card.columnId, columnName: fromColumn.name },
        to: { columnId: toColumn.id, columnName: toColumn.name },
      },
    });
  }
  return cardJson(await prisma.taskCard.findUniqueOrThrow({ where: { id: cardId }, include: cardInclude }));
}

export async function deleteCard(ctx: ApiContext, cardId: string) {
  const { card } = await loadCard(ctx, cardId);
  const boardId = card.column.boardId;
  const trashId = await trashCard(cardId, ctx.user.id);
  refresh(boardId);
  emitBoardEvent(boardId, "card.deleted", { cardId, actorId: ctx.user.id });
  return { id: cardId, trashId };
}

// ---------------------------------------------------------------------------
// Comments
// ---------------------------------------------------------------------------

export async function listComments(ctx: ApiContext, cardId: string, page: PageParams) {
  await loadCard(ctx, cardId);
  const rows = await prisma.taskCardComment.findMany({
    where: { cardId },
    include: commentInclude,
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    skip: page.skip,
    take: page.take + 1,
  });
  return rows.map(commentJson);
}

const commentSchema = z.object({ body: z.string().trim().min(1).max(5000) });

/**
 * Adds a comment. With an idempotency key (the Idempotency-Key header), a
 * repeated request returns the comment the first one created, with
 * `created: false`, and sends no second notification or webhook.
 */
export async function addComment(ctx: ApiContext, cardId: string, body: unknown, idempotencyKey?: string | null) {
  const data = commentSchema.parse(body);
  let clientKey: string | null;
  try {
    clientKey = parseClientKey(idempotencyKey);
  } catch {
    throw new ApiError(400, "invalid_idempotency_key", "Idempotency-Key must be 1 to 100 letters, digits or _ . : -");
  }
  const { card } = await loadCard(ctx, cardId);
  const boardId = card.column.boardId;
  const userId = ctx.user.id;
  let result: Awaited<ReturnType<typeof createCommentOnce>>;
  try {
    result = await createCommentOnce({ cardId, authorId: userId, body: data.body, clientKey });
  } catch (err) {
    if (err instanceof CommentKeyError) {
      throw new ApiError(409, "idempotency_key_conflict", "This Idempotency-Key was already used on this card by another user.");
    }
    throw err;
  }
  const { comment, created } = result;
  if (!created) return { comment: commentJson(comment), created };
  await notifyComment({ cardId, cardTitle: card.title, boardId, actorId: userId, actorName: actorName(ctx) }, data.body);
  revalidatePath(`/tasks/${boardId}/cards/${cardId}`);
  emitBoardEvent(boardId, "comment.created", { cardId, actorId: userId, commentId: comment.id });
  return { comment: commentJson(comment), created };
}
