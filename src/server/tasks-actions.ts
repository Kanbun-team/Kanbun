"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db-local";
import { auth, requireUser } from "@/auth";
import { canManageBoard, loadBoardAccess } from "@/server/board-access";
import { publishBoard, publishBoardList, publishUser } from "@/lib/realtime";
import { notify, notifyMany } from "@/lib/notifications";
import { safeAction } from "@/server/safe-action";
import { trashBoard, trashCard, trashColumn } from "@/server/trash";
import { ActionError } from "@/lib/action-result";
import { logActivity, type ActivityEntry } from "@/server/activity";
import { notifyComment, notifyMoved, notifyNewCards, watchCard } from "@/server/watchers";
import { getLocale } from "@/lib/get-locale";
import { BOARD_TEMPLATE_IDS, boardTemplateContent } from "@/lib/board-templates";
import { audit } from "@/server/audit";

/** The signed-in user as an audit actor (only called on rare, audited actions). */
async function auditActor() {
  const me = await requireUser();
  return { id: me.id, name: me.username };
}

// -----------------------------
// Boards
// -----------------------------

const colorSchema = z
  .string()
  .trim()
  .regex(/^#?[0-9a-fA-F]{6}$/, "Invalid color")
  .transform((v) => (v.startsWith("#") ? v : `#${v}`));

const createBoardSchema = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(2000).optional().nullable(),
  color: colorSchema.optional().default("#2563eb"),
  categoryId: z.string().min(1).optional().nullable(),
  memberIds: z.array(z.string().min(1)).default([]),
  template: z.enum(BOARD_TEMPLATE_IDS).default("simple"),
});

export async function createBoardAction(formData: FormData) {
  return safeAction(async () => {
    const user = await requireUser();
    const memberIdsRaw = formData.getAll("memberIds").map(String).filter(Boolean);
    const categoryId = (formData.get("categoryId") as string) || null;
    const data = createBoardSchema.parse({
      name: formData.get("name"),
      description: formData.get("description") || null,
      color: formData.get("color") || "#2563eb",
      categoryId,
      memberIds: memberIdsRaw,
      template: formData.get("template") || "simple",
    });
    const content = boardTemplateContent(data.template, await getLocale());

    const uniqueMemberIds = Array.from(
      new Set(data.memberIds.filter((id) => id !== user.id))
    );

    const memberCreates = [
      { userId: user.id, role: "owner" },
      ...uniqueMemberIds.map((id) => ({ userId: id, role: "member" })),
    ];

    const lastInTarget = await prisma.board.findFirst({
      where: { categoryId: data.categoryId ?? null },
      orderBy: { position: "desc" },
      select: { position: true },
    });
    const nextPosition = (lastInTarget?.position ?? -1) + 1;

    const board = await prisma.board.create({
      data: {
        name: data.name,
        description: data.description,
        color: data.color,
        categoryId: data.categoryId ?? null,
        position: nextPosition,
        createdById: user.id,
        members: { create: memberCreates },
        columns: { create: content.columns.map((name, position) => ({ name, position })) },
        tags: { create: content.tags.map((tag, position) => ({ ...tag, position })) },
      },
    });
    revalidatePath("/tasks");
    publishBoardList();
    redirect(`/tasks/${board.id}`);
  });
}

const moveBoardSchema = z.object({
  boardId: z.string().min(1),
  toCategoryId: z.string().min(1).nullable(),
  position: z.coerce.number().int().min(0),
});

export async function moveBoardAction(input: {
  boardId: string;
  toCategoryId: string | null;
  position: number;
}) {
  return safeAction(async () => {
    const user = await requireUser();
    const data = moveBoardSchema.parse(input);

    const board = await prisma.board.findUnique({
      where: { id: data.boardId },
      select: {
        categoryId: true,
        members: { where: { userId: user.id }, select: { userId: true } },
      },
    });
    if (!board) throw new ActionError("notFound");
    if (user.role !== "admin" && board.members.length === 0) {
      throw new ActionError("forbidden");
    }

    if (data.toCategoryId) {
      const cat = await prisma.boardCategory.findUnique({
        where: { id: data.toCategoryId },
        select: { id: true },
      });
      if (!cat) throw new ActionError("invalid");
    }

    await prisma.$transaction(async (tx) => {
      const sameCat = await tx.board.findMany({
        where: { categoryId: data.toCategoryId },
        orderBy: { position: "asc" },
        select: { id: true },
      });
      const ids = sameCat.map((b) => b.id).filter((id) => id !== data.boardId);
      const bounded = Math.max(0, Math.min(data.position, ids.length));
      const newOrder = [...ids.slice(0, bounded), data.boardId, ...ids.slice(bounded)];

      if (board.categoryId !== data.toCategoryId) {
        await tx.board.update({
          where: { id: data.boardId },
          data: { categoryId: data.toCategoryId },
        });
      }

      await Promise.all(
        newOrder.map((id, idx) =>
          tx.board.update({ where: { id }, data: { position: idx } })
        )
      );
    });

    revalidatePath("/tasks");
    publishBoardList();
  });
}

// -----------------------------
// Board categories
// -----------------------------

const createCategorySchema = z.object({
  name: z.string().trim().min(1).max(80),
  color: colorSchema.optional().default("#64748b"),
});

export async function createBoardCategoryAction(formData: FormData) {
  return safeAction(async () => {
    await requireUser();
    const data = createCategorySchema.parse({
      name: formData.get("name"),
      color: formData.get("color") || "#64748b",
    });
    const last = await prisma.boardCategory.findFirst({
      orderBy: { position: "desc" },
      select: { position: true },
    });
    await prisma.boardCategory.create({
      data: {
        name: data.name,
        color: data.color,
        position: (last?.position ?? -1) + 1,
      },
    });
    revalidatePath("/tasks");
    publishBoardList();
  });
}

export async function deleteBoardCategoryAction(formData: FormData) {
  return safeAction(async () => {
    const me = await requireUser();
    if (me.role !== "admin") throw new ActionError("forbidden");
    const id = String(formData.get("categoryId") ?? "");
    if (!id) throw new ActionError("invalid");
    await prisma.boardCategory.delete({ where: { id } });
    revalidatePath("/tasks");
    publishBoardList();
  });
}

const renameCategorySchema = z.object({
  categoryId: z.string().min(1),
  name: z.string().trim().min(1).max(80),
  color: colorSchema.optional(),
});

export async function updateBoardCategoryAction(formData: FormData) {
  return safeAction(async () => {
    const me = await requireUser();
    if (me.role !== "admin") throw new ActionError("forbidden");
    const data = renameCategorySchema.parse({
      categoryId: formData.get("categoryId"),
      name: formData.get("name"),
      color: formData.get("color") || undefined,
    });
    await prisma.boardCategory.update({
      where: { id: data.categoryId },
      data: { name: data.name, color: data.color },
    });
    revalidatePath("/tasks");
    publishBoardList();
  });
}

const renameBoardSchema = z.object({
  boardId: z.string().min(1),
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(2000).optional().nullable(),
  color: colorSchema.optional(),
});

export async function updateBoardAction(formData: FormData) {
  return safeAction(async () => {
    const data = renameBoardSchema.parse({
      boardId: formData.get("boardId"),
      name: formData.get("name"),
      description: formData.get("description") || null,
      color: formData.get("color") || undefined,
    });
    const access = await loadBoardAccess(data.boardId);
    if (!canManageBoard(access)) throw new ActionError("forbidden");
    await prisma.board.update({
      where: { id: data.boardId },
      data: {
        name: data.name,
        description: data.description,
        color: data.color,
      },
    });
    revalidatePath("/tasks");
    revalidatePath(`/tasks/${data.boardId}`);
    revalidatePath(`/tasks/${data.boardId}/settings`);
    publishBoard(data.boardId);
    publishBoardList();
  });
}

export async function archiveBoardAction(formData: FormData) {
  return safeAction(async () => {
    const boardId = String(formData.get("boardId") ?? "");
    const archived = formData.get("archived") === "true";
    const access = await loadBoardAccess(boardId);
    if (!canManageBoard(access)) throw new ActionError("forbidden");
    await prisma.board.update({ where: { id: boardId }, data: { archived } });
    revalidatePath("/tasks");
    revalidatePath(`/tasks/${boardId}`);
    publishBoard(boardId);
    publishBoardList();
  });
}

export async function deleteBoardAction(formData: FormData) {
  return safeAction(async () => {
    const boardId = String(formData.get("boardId") ?? "");
    const access = await loadBoardAccess(boardId);
    if (!canManageBoard(access)) throw new ActionError("forbidden");
    const board = await prisma.board.findUnique({ where: { id: boardId }, select: { name: true } });
    const trashId = await trashBoard(boardId, access.userId);
    await audit({
      action: "board.delete",
      actor: await auditActor(),
      target: { type: "board", id: boardId, name: board?.name ?? null },
      details: { trashId },
    });
    revalidatePath("/tasks");
    revalidatePath("/trash");
    publishBoard(boardId);
    publishBoardList();
    return { trashId };
  });
}

// -----------------------------
// Members
// -----------------------------

async function boardName(boardId: string): Promise<string | null> {
  const board = await prisma.board.findUnique({ where: { id: boardId }, select: { name: true } });
  return board?.name ?? null;
}

const memberAddSchema = z.object({
  boardId: z.string().min(1),
  username: z.string().trim().min(1),
});

export async function addBoardMemberAction(formData: FormData) {
  return safeAction(async () => {
    const data = memberAddSchema.parse({
      boardId: formData.get("boardId"),
      username: formData.get("username"),
    });
    const access = await loadBoardAccess(data.boardId);
    if (!canManageBoard(access)) throw new ActionError("forbidden");
    const target = await prisma.user.findUnique({
      where: { username: data.username.toLowerCase() },
    });
    if (!target || target.deactivatedAt) throw new ActionError("userNotFound");
    const existing = await prisma.boardMember.findUnique({
      where: { boardId_userId: { boardId: data.boardId, userId: target.id } },
      select: { role: true },
    });
    await prisma.boardMember.upsert({
      where: { boardId_userId: { boardId: data.boardId, userId: target.id } },
      update: {},
      create: { boardId: data.boardId, userId: target.id, role: "member" },
    });
    if (!existing) {
      await audit({
        action: "board.memberAdd",
        actor: await auditActor(),
        target: { type: "board", id: data.boardId, name: await boardName(data.boardId) },
        details: { user: target.username, role: "member" },
      });
    }
    revalidatePath(`/tasks/${data.boardId}/settings`);
    publishBoardList();
  });
}

const memberUpdateSchema = z.object({
  boardId: z.string().min(1),
  userId: z.string().min(1),
  role: z.enum(["owner", "member"]),
});

export async function updateBoardMemberAction(formData: FormData) {
  return safeAction(async () => {
    const data = memberUpdateSchema.parse({
      boardId: formData.get("boardId"),
      userId: formData.get("userId"),
      role: formData.get("role"),
    });
    const access = await loadBoardAccess(data.boardId);
    if (!canManageBoard(access)) throw new ActionError("forbidden");
    const before = await prisma.boardMember.findUnique({
      where: { boardId_userId: { boardId: data.boardId, userId: data.userId } },
      select: { role: true },
    });
    const updated = await prisma.boardMember.update({
      where: { boardId_userId: { boardId: data.boardId, userId: data.userId } },
      data: { role: data.role },
      select: { user: { select: { username: true } } },
    });
    if (before && before.role !== data.role) {
      await audit({
        action: "board.memberRole",
        actor: await auditActor(),
        target: { type: "board", id: data.boardId, name: await boardName(data.boardId) },
        details: { user: updated.user.username, from: before.role, to: data.role },
      });
    }
    revalidatePath(`/tasks/${data.boardId}/settings`);
  });
}

export async function removeBoardMemberAction(formData: FormData) {
  return safeAction(async () => {
    const boardId = String(formData.get("boardId") ?? "");
    const userId = String(formData.get("userId") ?? "");
    const access = await loadBoardAccess(boardId);
    if (!canManageBoard(access)) throw new ActionError("forbidden");
    const removed = await prisma.boardMember.delete({
      where: { boardId_userId: { boardId, userId } },
      select: { role: true, user: { select: { username: true } } },
    });
    await audit({
      action: "board.memberRemove",
      actor: await auditActor(),
      target: { type: "board", id: boardId, name: await boardName(boardId) },
      details: { user: removed.user.username, role: removed.role },
    });
    revalidatePath(`/tasks/${boardId}/settings`);
    publishBoardList();
  });
}

// -----------------------------
// Columns
// -----------------------------

const columnAddSchema = z.object({
  boardId: z.string().min(1),
  name: z.string().trim().min(1).max(80),
});

export async function addColumnAction(formData: FormData) {
  return safeAction(async () => {
    const data = columnAddSchema.parse({
      boardId: formData.get("boardId"),
      name: formData.get("name"),
    });
    await loadBoardAccess(data.boardId);
    const last = await prisma.boardColumn.findFirst({
      where: { boardId: data.boardId },
      orderBy: { position: "desc" },
      select: { position: true },
    });
    await prisma.boardColumn.create({
      data: {
        boardId: data.boardId,
        name: data.name,
        position: (last?.position ?? -1) + 1,
      },
    });
    revalidatePath(`/tasks/${data.boardId}`);
    publishBoard(data.boardId);
  });
}

const columnRenameSchema = z.object({
  columnId: z.string().min(1),
  name: z.string().trim().min(1).max(80),
  wipLimit: z
    .preprocess(
      (v) => (v === "" || v === null || v === undefined ? null : Number(v)),
      z.number().int().min(1).max(999).nullable()
    )
    .optional(),
});

export async function renameColumnAction(formData: FormData) {
  return safeAction(async () => {
    const data = columnRenameSchema.parse({
      columnId: formData.get("columnId"),
      name: formData.get("name"),
      wipLimit: formData.has("wipLimit") ? formData.get("wipLimit") : undefined,
    });
    const col = await prisma.boardColumn.findUnique({
      where: { id: data.columnId },
      select: { boardId: true },
    });
    if (!col) throw new ActionError("notFound");
    await loadBoardAccess(col.boardId);
    await prisma.boardColumn.update({
      where: { id: data.columnId },
      data: {
        name: data.name,
        ...(data.wipLimit !== undefined ? { wipLimit: data.wipLimit } : {}),
      },
    });
    revalidatePath(`/tasks/${col.boardId}`);
    publishBoard(col.boardId);
  });
}

const columnMoveSchema = z.object({
  columnId: z.string().min(1),
  position: z.coerce.number().int().min(0),
});

export async function moveColumnAction(input: { columnId: string; position: number }) {
  return safeAction(async () => {
    const data = columnMoveSchema.parse(input);
    const col = await prisma.boardColumn.findUnique({
      where: { id: data.columnId },
      select: { boardId: true },
    });
    if (!col) throw new ActionError("notFound");
    const access = await loadBoardAccess(col.boardId);
    if (!canManageBoard(access)) throw new ActionError("forbidden");
    await prisma.$transaction(async (tx) => {
      const cols = await tx.boardColumn.findMany({
        where: { boardId: col.boardId },
        orderBy: { position: "asc" },
        select: { id: true },
      });
      const ids = cols.map((c) => c.id).filter((id) => id !== data.columnId);
      const bounded = Math.max(0, Math.min(data.position, ids.length));
      ids.splice(bounded, 0, data.columnId);
      await Promise.all(ids.map((id, idx) => tx.boardColumn.update({ where: { id }, data: { position: idx } })));
    });
    revalidatePath(`/tasks/${col.boardId}`);
    publishBoard(col.boardId);
  });
}

export async function deleteColumnAction(formData: FormData) {
  return safeAction(async () => {
    const columnId = String(formData.get("columnId") ?? "");
    const col = await prisma.boardColumn.findUnique({
      where: { id: columnId },
      select: { boardId: true },
    });
    if (!col) throw new ActionError("notFound");
    const access = await loadBoardAccess(col.boardId);
    if (!canManageBoard(access)) throw new ActionError("forbidden");
    const trashId = await trashColumn(columnId, access.userId);
    revalidatePath(`/tasks/${col.boardId}`);
    publishBoard(col.boardId);
    return { trashId };
  });
}

// -----------------------------
// Cards
// -----------------------------

const cardCreateSchema = z.object({
  columnId: z.string().min(1),
  title: z.string().trim().min(1).max(200),
});

// Each non-empty line of the title becomes its own card, so pasting a list
// creates one card per line (up to 50).
export async function addCardAction(formData: FormData) {
  return safeAction(async () => {
    const user = await requireUser();
    const columnId = z.string().min(1).parse(formData.get("columnId"));
    const titles = String(formData.get("title") ?? "")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .slice(0, 50)
      .map((title) => cardCreateSchema.shape.title.parse(title));
    if (titles.length === 0) throw new ActionError("invalid");
    const col = await prisma.boardColumn.findUnique({
      where: { id: columnId },
      select: { boardId: true, name: true },
    });
    if (!col) throw new ActionError("notFound");
    await loadBoardAccess(col.boardId);
    const last = await prisma.taskCard.findFirst({
      where: { columnId },
      orderBy: { position: "desc" },
      select: { position: true },
    });
    let position = (last?.position ?? -1) + 1;
    const created: { id: string; title: string }[] = [];
    await prisma.$transaction(async (tx) => {
      for (const title of titles) {
        const card = await tx.taskCard.create({
          data: { columnId, title, position: position++, createdById: user.id },
        });
        created.push({ id: card.id, title: card.title });
        await watchCard(card.id, user.id, tx);
        await tx.taskCardMoveEvent.create({
          data: { cardId: card.id, cardTitle: card.title, boardId: col.boardId, toColumnName: col.name, userId: user.id },
        });
        await logActivity(
          { cardId: card.id, boardId: col.boardId, actorId: user.id, type: "created", data: { column: col.name } },
          tx
        );
      }
    });
    await notifyNewCards(col.boardId, created, { id: user.id, name: user.displayName ?? user.username });
    revalidatePath(`/tasks/${col.boardId}`);
    publishBoard(col.boardId);
    return { count: titles.length };
  });
}

const cardUpdateSchema = z.object({
  cardId: z.string().min(1),
  title: z.string().trim().min(1).max(200).optional(),
  description: z.string().trim().max(20_000).optional().nullable(),
  priority: z.enum(["low", "normal", "high", "critical"]).optional(),
  deadline: z.string().optional().nullable(),
  coverColor: z
    .string()
    .trim()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .optional()
    .nullable(),
});

export async function updateCardAction(formData: FormData) {
  return safeAction(async () => {
    const rawCover = formData.has("coverColor") ? String(formData.get("coverColor") ?? "") : undefined;
    const data = cardUpdateSchema.parse({
      cardId: formData.get("cardId"),
      title: formData.get("title") ?? undefined,
      description: formData.has("description") ? formData.get("description") : undefined,
      priority: formData.get("priority") ?? undefined,
      deadline: formData.has("deadline") ? formData.get("deadline") : undefined,
      coverColor: rawCover === "" ? null : rawCover,
    });
    const card = await prisma.taskCard.findUnique({
      where: { id: data.cardId },
      select: {
        title: true,
        description: true,
        priority: true,
        deadline: true,
        column: { select: { boardId: true } },
      },
    });
    if (!card) throw new ActionError("notFound");
    const access = await loadBoardAccess(card.column.boardId);

    let deadline: Date | null | undefined = undefined;
    if (data.deadline === null || data.deadline === "") deadline = null;
    else if (data.deadline) {
      const d = new Date(data.deadline);
      deadline = Number.isNaN(d.getTime()) ? undefined : d;
    }

    const base = { cardId: data.cardId, boardId: card.column.boardId, actorId: access.userId };
    const activity: ActivityEntry[] = [];
    if (data.title !== undefined && data.title !== card.title) {
      activity.push({ ...base, type: "renamed", data: { from: card.title, to: data.title } });
    }
    if (data.priority !== undefined && data.priority !== card.priority) {
      activity.push({ ...base, type: "priority", data: { from: card.priority, to: data.priority } });
    }
    if (deadline !== undefined && (deadline?.getTime() ?? null) !== (card.deadline?.getTime() ?? null)) {
      activity.push({ ...base, type: "deadline", data: { to: deadline ? deadline.toISOString() : null } });
    }
    if (
      data.description !== undefined &&
      data.description !== null &&
      data.description !== (card.description ?? "")
    ) {
      activity.push({ ...base, type: "description", data: {} });
    }

    await prisma.$transaction(async (tx) => {
      await tx.taskCard.update({
        where: { id: data.cardId },
        data: {
          title: data.title,
          description: data.description ?? undefined,
          priority: data.priority,
          deadline,
          coverColor: rawCover === undefined ? undefined : data.coverColor,
        },
      });
      await logActivity(activity, tx);
    });
    revalidatePath(`/tasks/${card.column.boardId}`);
    revalidatePath(`/tasks/${card.column.boardId}/cards/${data.cardId}`);
    publishBoard(card.column.boardId);
  });
}

export async function deleteCardAction(formData: FormData) {
  return safeAction(async () => {
    const cardId = String(formData.get("cardId") ?? "");
    const card = await prisma.taskCard.findUnique({
      where: { id: cardId },
      select: { column: { select: { boardId: true } } },
    });
    if (!card) throw new ActionError("notFound");
    const access = await loadBoardAccess(card.column.boardId);
    const trashId = await trashCard(cardId, access.userId);
    revalidatePath(`/tasks/${card.column.boardId}`);
    publishBoard(card.column.boardId);
    return { trashId, boardId: card.column.boardId };
  });
}

const cardMoveSchema = z.object({
  cardId: z.string().min(1),
  toColumnId: z.string().min(1),
  position: z.coerce.number().int().min(0),
});

export async function moveCardAction(input: {
  cardId: string;
  toColumnId: string;
  position: number;
}) {
  return safeAction(async () => {
    const user = await requireUser();
    const data = cardMoveSchema.parse(input);

    const card = await prisma.taskCard.findUnique({
      where: { id: data.cardId },
      select: {
        title: true,
        columnId: true,
        column: { select: { name: true, boardId: true } },
      },
    });
    if (!card) throw new ActionError("notFound");
    const access = await loadBoardAccess(card.column.boardId);

    const toCol = await prisma.boardColumn.findUnique({
      where: { id: data.toColumnId },
      select: { name: true, boardId: true },
    });
    if (!toCol || toCol.boardId !== card.column.boardId) throw new ActionError("forbidden");
    void access;

    await prisma.$transaction(async (tx) => {
      if (card.columnId !== data.toColumnId) {
        const sameCol = await tx.taskCard.findMany({
          where: { columnId: data.toColumnId },
          orderBy: { position: "asc" },
          select: { id: true },
        });
        const ids = sameCol.map((c) => c.id);
        const bounded = Math.max(0, Math.min(data.position, ids.length));
        const newOrder = [...ids.slice(0, bounded), data.cardId, ...ids.slice(bounded)];
        await tx.taskCard.update({
          where: { id: data.cardId },
          data: { columnId: data.toColumnId, position: bounded },
        });
        await Promise.all(
          newOrder.map((id, idx) =>
            tx.taskCard.update({ where: { id }, data: { position: idx } })
          )
        );
        await tx.taskCardMoveEvent.create({
          data: {
            cardId: data.cardId,
            cardTitle: card.title,
            boardId: card.column.boardId,
            fromColumnName: card.column.name,
            toColumnName: toCol.name,
            userId: user.id,
          },
        });
        await logActivity(
          {
            cardId: data.cardId,
            boardId: card.column.boardId,
            actorId: user.id,
            type: "moved",
            data: { from: card.column.name, to: toCol.name },
          },
          tx
        );
      } else {
        const sameCol = await tx.taskCard.findMany({
          where: { columnId: data.toColumnId },
          orderBy: { position: "asc" },
          select: { id: true },
        });
        const ids = sameCol.map((c) => c.id).filter((id) => id !== data.cardId);
        const bounded = Math.max(0, Math.min(data.position, ids.length));
        const newOrder = [...ids.slice(0, bounded), data.cardId, ...ids.slice(bounded)];
        await Promise.all(
          newOrder.map((id, idx) =>
            tx.taskCard.update({ where: { id }, data: { position: idx } })
          )
        );
      }
    });

    if (card.columnId !== data.toColumnId) {
      await notifyMoved({
        cardId: data.cardId,
        cardTitle: card.title,
        boardId: card.column.boardId,
        actorId: user.id,
        actorName: user.displayName ?? user.username,
      });
    }
    revalidatePath(`/tasks/${card.column.boardId}`);
    publishBoard(card.column.boardId);
  });
}

// -----------------------------
// Assignees
// -----------------------------

const assigneeSchema = z.object({
  cardId: z.string().min(1),
  userId: z.string().min(1),
});

export async function toggleAssigneeAction(formData: FormData) {
  return safeAction(async () => {
    const user = await requireUser();
    const data = assigneeSchema.parse({
      cardId: formData.get("cardId"),
      userId: formData.get("userId"),
    });
    const card = await prisma.taskCard.findUnique({
      where: { id: data.cardId },
      select: { title: true, column: { select: { boardId: true } } },
    });
    if (!card) throw new ActionError("notFound");
    await loadBoardAccess(card.column.boardId);
    const existing = await prisma.taskCardAssignee.findUnique({
      where: { cardId_userId: { cardId: data.cardId, userId: data.userId } },
    });
    const target = await prisma.user.findUnique({
      where: { id: data.userId },
      select: { username: true, displayName: true },
    });
    const activityBase = { cardId: data.cardId, boardId: card.column.boardId, actorId: user.id };
    const targetName = target ? target.displayName ?? target.username : "";
    if (existing) {
      await prisma.$transaction(async (tx) => {
        await tx.taskCardAssignee.delete({
          where: { cardId_userId: { cardId: data.cardId, userId: data.userId } },
        });
        await logActivity({ ...activityBase, type: "assigneeRemoved", data: { name: targetName } }, tx);
      });
    } else {
      // Only board members can be assigned: otherwise any member could assign
      // (and notify, leaking the card title to) arbitrary users of the instance.
      const targetMember = await prisma.boardMember.findUnique({
        where: { boardId_userId: { boardId: card.column.boardId, userId: data.userId } },
        select: { userId: true, user: { select: { deactivatedAt: true } } },
      });
      if (!targetMember || targetMember.user.deactivatedAt) throw new ActionError("forbidden");
      await prisma.$transaction(async (tx) => {
        await tx.taskCardAssignee.create({
          data: { cardId: data.cardId, userId: data.userId },
        });
        await logActivity({ ...activityBase, type: "assigneeAdded", data: { name: targetName } }, tx);
        await watchCard(data.cardId, data.userId, tx);
      });
      await notify({
        recipientId: data.userId,
        type: "assigned",
        cardId: data.cardId,
        cardTitle: card.title,
        boardId: card.column.boardId,
        actorId: user.id,
        actorName: user.displayName ?? user.username,
      });
    }
    revalidatePath(`/tasks/${card.column.boardId}`);
    revalidatePath(`/tasks/${card.column.boardId}/cards/${data.cardId}`);
    publishBoard(card.column.boardId);
  });
}

// -----------------------------
// Subtasks
// -----------------------------

export async function addSubtaskAction(formData: FormData) {
  return safeAction(async () => {
    const cardId = String(formData.get("cardId") ?? "");
    const title = String(formData.get("title") ?? "").trim();
    if (!cardId || !title) throw new ActionError("invalid");
    const card = await prisma.taskCard.findUnique({
      where: { id: cardId },
      select: { column: { select: { boardId: true } } },
    });
    if (!card) throw new ActionError("notFound");
    await loadBoardAccess(card.column.boardId);
    const last = await prisma.taskSubtask.findFirst({
      where: { cardId },
      orderBy: { position: "desc" },
      select: { position: true },
    });
    await prisma.taskSubtask.create({
      data: {
        cardId,
        title: title.slice(0, 200),
        position: (last?.position ?? -1) + 1,
      },
    });
    revalidatePath(`/tasks/${card.column.boardId}/cards/${cardId}`);
  });
}

export async function toggleSubtaskAction(formData: FormData) {
  return safeAction(async () => {
    const user = await requireUser();
    const subtaskId = String(formData.get("subtaskId") ?? "");
    const sub = await prisma.taskSubtask.findUnique({
      where: { id: subtaskId },
      select: {
        done: true,
        title: true,
        cardId: true,
        card: { select: { column: { select: { boardId: true } } } },
      },
    });
    if (!sub) throw new ActionError("notFound");
    await loadBoardAccess(sub.card.column.boardId);
    const newDone = !sub.done;
    await prisma.$transaction(async (tx) => {
      await tx.taskSubtask.update({
        where: { id: subtaskId },
        data: {
          done: newDone,
          completedAt: newDone ? new Date() : null,
          completedById: newDone ? user.id : null,
        },
      });
      if (newDone) {
        await logActivity(
          {
            cardId: sub.cardId,
            boardId: sub.card.column.boardId,
            actorId: user.id,
            type: "subtaskDone",
            data: { title: sub.title },
          },
          tx
        );
      }
    });
    revalidatePath(`/tasks/${sub.card.column.boardId}/cards/${sub.cardId}`);
  });
}

export async function renameSubtaskAction(formData: FormData) {
  return safeAction(async () => {
    const subtaskId = String(formData.get("subtaskId") ?? "");
    const title = String(formData.get("title") ?? "").trim().slice(0, 200);
    if (!subtaskId || !title) throw new ActionError("invalid");
    const sub = await prisma.taskSubtask.findUnique({
      where: { id: subtaskId },
      select: { cardId: true, card: { select: { column: { select: { boardId: true } } } } },
    });
    if (!sub) throw new ActionError("notFound");
    await loadBoardAccess(sub.card.column.boardId);
    await prisma.taskSubtask.update({ where: { id: subtaskId }, data: { title } });
    revalidatePath(`/tasks/${sub.card.column.boardId}/cards/${sub.cardId}`);
  });
}

export async function deleteSubtaskAction(formData: FormData) {
  return safeAction(async () => {
    const subtaskId = String(formData.get("subtaskId") ?? "");
    const sub = await prisma.taskSubtask.findUnique({
      where: { id: subtaskId },
      select: { cardId: true, card: { select: { column: { select: { boardId: true } } } } },
    });
    if (!sub) throw new ActionError("notFound");
    await loadBoardAccess(sub.card.column.boardId);
    await prisma.taskSubtask.delete({ where: { id: subtaskId } });
    revalidatePath(`/tasks/${sub.card.column.boardId}/cards/${sub.cardId}`);
  });
}

// -----------------------------
// Tags
// -----------------------------

const tagCreateSchema = z.object({
  boardId: z.string().min(1),
  name: z.string().trim().min(1).max(40),
  color: z.string().regex(/^#?[0-9a-fA-F]{6}$/),
});

export async function createBoardTagAction(formData: FormData) {
  return safeAction(async () => {
    const data = tagCreateSchema.parse({
      boardId: formData.get("boardId"),
      name: formData.get("name"),
      color: formData.get("color"),
    });
    const access = await loadBoardAccess(data.boardId);
    if (!canManageBoard(access)) throw new ActionError("forbidden");
    const last = await prisma.boardTag.findFirst({
      where: { boardId: data.boardId },
      orderBy: { position: "desc" },
      select: { position: true },
    });
    const color = data.color.startsWith("#") ? data.color : `#${data.color}`;
    await prisma.boardTag.create({
      data: {
        boardId: data.boardId,
        name: data.name,
        color,
        position: (last?.position ?? -1) + 1,
      },
    });
    revalidatePath(`/tasks/${data.boardId}/settings`);
    revalidatePath(`/tasks/${data.boardId}`);
    publishBoard(data.boardId);
  });
}

export async function deleteBoardTagAction(formData: FormData) {
  return safeAction(async () => {
    const tagId = String(formData.get("tagId") ?? "");
    const tag = await prisma.boardTag.findUnique({
      where: { id: tagId },
      select: { boardId: true },
    });
    if (!tag) throw new ActionError("notFound");
    const access = await loadBoardAccess(tag.boardId);
    if (!canManageBoard(access)) throw new ActionError("forbidden");
    await prisma.boardTag.delete({ where: { id: tagId } });
    revalidatePath(`/tasks/${tag.boardId}/settings`);
    revalidatePath(`/tasks/${tag.boardId}`);
    publishBoard(tag.boardId);
  });
}

export async function toggleCardTagAction(formData: FormData) {
  return safeAction(async () => {
    const cardId = String(formData.get("cardId") ?? "");
    const tagId = String(formData.get("tagId") ?? "");
    const card = await prisma.taskCard.findUnique({
      where: { id: cardId },
      select: { column: { select: { boardId: true } } },
    });
    const tag = await prisma.boardTag.findUnique({
      where: { id: tagId },
      select: { boardId: true, name: true },
    });
    if (!card || !tag || tag.boardId !== card.column.boardId) throw new ActionError("notFound");
    const access = await loadBoardAccess(card.column.boardId);
    const existing = await prisma.taskCardTag.findUnique({
      where: { cardId_tagId: { cardId, tagId } },
    });
    await prisma.$transaction(async (tx) => {
      if (existing) {
        await tx.taskCardTag.delete({ where: { cardId_tagId: { cardId, tagId } } });
      } else {
        await tx.taskCardTag.create({ data: { cardId, tagId } });
      }
      await logActivity(
        {
          cardId,
          boardId: card.column.boardId,
          actorId: access.userId,
          type: existing ? "tagRemoved" : "tagAdded",
          data: { name: tag.name },
        },
        tx
      );
    });
    revalidatePath(`/tasks/${card.column.boardId}`);
    revalidatePath(`/tasks/${card.column.boardId}/cards/${cardId}`);
    publishBoard(card.column.boardId);
  });
}

// -----------------------------
// Comments
// -----------------------------

export async function addCommentAction(formData: FormData) {
  return safeAction(async () => {
    const user = await requireUser();
    const cardId = String(formData.get("cardId") ?? "");
    const body = String(formData.get("body") ?? "").trim();
    if (!cardId || !body) throw new ActionError("invalid");
    const card = await prisma.taskCard.findUnique({
      where: { id: cardId },
      select: { title: true, column: { select: { boardId: true } } },
    });
    if (!card) throw new ActionError("notFound");
    const boardId = card.column.boardId;
    await loadBoardAccess(boardId);
    await prisma.$transaction(async (tx) => {
      await tx.taskCardComment.create({
        data: {
          cardId,
          authorId: user.id,
          body: body.slice(0, 5000),
        },
      });
      await watchCard(cardId, user.id, tx);
    });

    // Mentioned board members get "mention", card watchers "comment" (once each).
    await notifyComment(
      { cardId, cardTitle: card.title, boardId, actorId: user.id, actorName: user.displayName ?? user.username },
      body
    );

    revalidatePath(`/tasks/${boardId}/cards/${cardId}`);
  });
}

export async function deleteCommentAction(formData: FormData) {
  return safeAction(async () => {
    const user = await requireUser();
    const commentId = String(formData.get("commentId") ?? "");
    const comment = await prisma.taskCardComment.findUnique({
      where: { id: commentId },
      select: {
        authorId: true,
        cardId: true,
        card: { select: { column: { select: { boardId: true } } } },
      },
    });
    if (!comment) throw new ActionError("notFound");
    const access = await loadBoardAccess(comment.card.column.boardId);
    if (comment.authorId !== user.id && !canManageBoard(access)) throw new ActionError("forbidden");
    await prisma.taskCardComment.delete({ where: { id: commentId } });
    revalidatePath(`/tasks/${comment.card.column.boardId}/cards/${comment.cardId}`);
  });
}

// -----------------------------
// Blocking
// -----------------------------

export async function addBlockAction(formData: FormData) {
  return safeAction(async () => {
    const user = await requireUser();
    const blockerId = String(formData.get("blockerId") ?? "");
    const blockedId = String(formData.get("blockedId") ?? "");
    if (!blockerId || !blockedId || blockerId === blockedId) throw new ActionError("invalid");
    const [a, b] = await Promise.all([
      prisma.taskCard.findUnique({
        where: { id: blockerId },
        select: { title: true, column: { select: { boardId: true } } },
      }),
      prisma.taskCard.findUnique({
        where: { id: blockedId },
        select: { column: { select: { boardId: true } } },
      }),
    ]);
    if (!a || !b) throw new ActionError("notFound");
    if (a.column.boardId !== b.column.boardId) throw new ActionError("crossBoard");
    await loadBoardAccess(a.column.boardId);
    const existing = await prisma.taskBlock.findUnique({
      where: { blockerId_blockedId: { blockerId, blockedId } },
      select: { id: true },
    });
    await prisma.$transaction(async (tx) => {
      await tx.taskBlock.upsert({
        where: { blockerId_blockedId: { blockerId, blockedId } },
        update: {},
        create: { blockerId, blockedId, createdById: user.id },
      });
      if (!existing) {
        await logActivity(
          {
            cardId: blockedId,
            boardId: a.column.boardId,
            actorId: user.id,
            type: "blocked",
            data: { title: a.title },
          },
          tx
        );
      }
    });

    // Notify the assignees of the card that just became blocked.
    const blockedCard = await prisma.taskCard.findUnique({
      where: { id: blockedId },
      select: { title: true, assignees: { select: { userId: true } } },
    });
    if (blockedCard) {
      await notifyMany(
        blockedCard.assignees.map((asg) => ({
          recipientId: asg.userId,
          type: "blocked" as const,
          cardId: blockedId,
          cardTitle: blockedCard.title,
          boardId: a.column.boardId,
          actorId: user.id,
          actorName: user.displayName ?? user.username,
        }))
      );
    }

    revalidatePath(`/tasks/${a.column.boardId}/cards/${blockedId}`);
    revalidatePath(`/tasks/${a.column.boardId}/cards/${blockerId}`);
  });
}

export async function removeBlockAction(formData: FormData) {
  return safeAction(async () => {
    const blockId = String(formData.get("blockId") ?? "");
    const block = await prisma.taskBlock.findUnique({
      where: { id: blockId },
      select: {
        blockerId: true,
        blockedId: true,
        blocker: { select: { title: true } },
        blocked: { select: { column: { select: { boardId: true } } } },
      },
    });
    if (!block) throw new ActionError("notFound");
    const access = await loadBoardAccess(block.blocked.column.boardId);
    await prisma.$transaction(async (tx) => {
      await tx.taskBlock.delete({ where: { id: blockId } });
      await logActivity(
        {
          cardId: block.blockedId,
          boardId: block.blocked.column.boardId,
          actorId: access.userId,
          type: "unblocked",
          data: { title: block.blocker.title },
        },
        tx
      );
    });
    revalidatePath(`/tasks/${block.blocked.column.boardId}/cards/${block.blockedId}`);
    revalidatePath(`/tasks/${block.blocked.column.boardId}/cards/${block.blockerId}`);
  });
}

// -----------------------------
// Notifications
// -----------------------------

export async function markNotificationReadAction(formData: FormData) {
  return safeAction(async () => {
    const user = await requireUser();
    const id = String(formData.get("notificationId") ?? "");
    if (!id) return;
    await prisma.notification.updateMany({
      where: { id, userId: user.id },
      data: { read: true },
    });
    publishUser(user.id);
  });
}

export async function markAllNotificationsReadAction() {
  return safeAction(async () => {
    const user = await requireUser();
    await prisma.notification.updateMany({
      where: { userId: user.id, read: false },
      data: { read: true },
    });
    publishUser(user.id);
  });
}

export async function whoami() {
  return await auth();
}
