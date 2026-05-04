"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db-local";
import { auth, requireUser } from "@/auth";
import { canManageBoard, loadBoardAccess } from "@/server/board-access";

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
});

export async function createBoardAction(formData: FormData) {
  const user = await requireUser();
  const memberIdsRaw = formData.getAll("memberIds").map(String).filter(Boolean);
  const categoryId = (formData.get("categoryId") as string) || null;
  const data = createBoardSchema.parse({
    name: formData.get("name"),
    description: formData.get("description") || null,
    color: formData.get("color") || "#2563eb",
    categoryId,
    memberIds: memberIdsRaw,
  });

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
      columns: {
        create: [
          { name: "To do", position: 0 },
          { name: "Doing", position: 1 },
          { name: "Done", position: 2 },
        ],
      },
    },
  });
  revalidatePath("/tasks");
  redirect(`/tasks/${board.id}`);
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
  const user = await requireUser();
  const data = moveBoardSchema.parse(input);

  const board = await prisma.board.findUnique({
    where: { id: data.boardId },
    select: {
      categoryId: true,
      members: { where: { userId: user.id }, select: { userId: true } },
    },
  });
  if (!board) throw new Error("Not found");
  if (user.role !== "admin" && board.members.length === 0) {
    throw new Error("Forbidden");
  }

  if (data.toCategoryId) {
    const cat = await prisma.boardCategory.findUnique({
      where: { id: data.toCategoryId },
      select: { id: true },
    });
    if (!cat) throw new Error("Invalid category");
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
}

// -----------------------------
// Board categories
// -----------------------------

const createCategorySchema = z.object({
  name: z.string().trim().min(1).max(80),
  color: colorSchema.optional().default("#64748b"),
});

export async function createBoardCategoryAction(formData: FormData) {
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
}

export async function deleteBoardCategoryAction(formData: FormData) {
  const me = await requireUser();
  if (me.role !== "admin") throw new Error("Forbidden");
  const id = String(formData.get("categoryId") ?? "");
  if (!id) throw new Error("Invalid input");
  await prisma.boardCategory.delete({ where: { id } });
  revalidatePath("/tasks");
}

const renameCategorySchema = z.object({
  categoryId: z.string().min(1),
  name: z.string().trim().min(1).max(80),
  color: colorSchema.optional(),
});

export async function updateBoardCategoryAction(formData: FormData) {
  const me = await requireUser();
  if (me.role !== "admin") throw new Error("Forbidden");
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
}

const renameBoardSchema = z.object({
  boardId: z.string().min(1),
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(2000).optional().nullable(),
  color: colorSchema.optional(),
});

export async function updateBoardAction(formData: FormData) {
  const data = renameBoardSchema.parse({
    boardId: formData.get("boardId"),
    name: formData.get("name"),
    description: formData.get("description") || null,
    color: formData.get("color") || undefined,
  });
  const access = await loadBoardAccess(data.boardId);
  if (!canManageBoard(access)) throw new Error("Forbidden");
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
}

export async function archiveBoardAction(formData: FormData) {
  const boardId = String(formData.get("boardId") ?? "");
  const archived = formData.get("archived") === "true";
  const access = await loadBoardAccess(boardId);
  if (!canManageBoard(access)) throw new Error("Forbidden");
  await prisma.board.update({ where: { id: boardId }, data: { archived } });
  revalidatePath("/tasks");
  revalidatePath(`/tasks/${boardId}`);
}

export async function deleteBoardAction(formData: FormData) {
  const boardId = String(formData.get("boardId") ?? "");
  const access = await loadBoardAccess(boardId);
  if (!canManageBoard(access)) throw new Error("Forbidden");
  await prisma.board.delete({ where: { id: boardId } });
  revalidatePath("/tasks");
  redirect("/tasks");
}

// -----------------------------
// Members
// -----------------------------

const memberAddSchema = z.object({
  boardId: z.string().min(1),
  username: z.string().trim().min(1),
});

export async function addBoardMemberAction(formData: FormData) {
  const data = memberAddSchema.parse({
    boardId: formData.get("boardId"),
    username: formData.get("username"),
  });
  const access = await loadBoardAccess(data.boardId);
  if (!canManageBoard(access)) throw new Error("Forbidden");
  const target = await prisma.user.findUnique({
    where: { username: data.username.toLowerCase() },
  });
  if (!target) throw new Error("User not found");
  await prisma.boardMember.upsert({
    where: { boardId_userId: { boardId: data.boardId, userId: target.id } },
    update: {},
    create: { boardId: data.boardId, userId: target.id, role: "member" },
  });
  revalidatePath(`/tasks/${data.boardId}/settings`);
}

const memberUpdateSchema = z.object({
  boardId: z.string().min(1),
  userId: z.string().min(1),
  role: z.enum(["owner", "member"]),
});

export async function updateBoardMemberAction(formData: FormData) {
  const data = memberUpdateSchema.parse({
    boardId: formData.get("boardId"),
    userId: formData.get("userId"),
    role: formData.get("role"),
  });
  const access = await loadBoardAccess(data.boardId);
  if (!canManageBoard(access)) throw new Error("Forbidden");
  await prisma.boardMember.update({
    where: { boardId_userId: { boardId: data.boardId, userId: data.userId } },
    data: { role: data.role },
  });
  revalidatePath(`/tasks/${data.boardId}/settings`);
}

export async function removeBoardMemberAction(formData: FormData) {
  const boardId = String(formData.get("boardId") ?? "");
  const userId = String(formData.get("userId") ?? "");
  const access = await loadBoardAccess(boardId);
  if (!canManageBoard(access)) throw new Error("Forbidden");
  await prisma.boardMember.delete({
    where: { boardId_userId: { boardId, userId } },
  });
  revalidatePath(`/tasks/${boardId}/settings`);
}

// -----------------------------
// Columns
// -----------------------------

const columnAddSchema = z.object({
  boardId: z.string().min(1),
  name: z.string().trim().min(1).max(80),
});

export async function addColumnAction(formData: FormData) {
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
}

const columnRenameSchema = z.object({
  columnId: z.string().min(1),
  name: z.string().trim().min(1).max(80),
});

export async function renameColumnAction(formData: FormData) {
  const data = columnRenameSchema.parse({
    columnId: formData.get("columnId"),
    name: formData.get("name"),
  });
  const col = await prisma.boardColumn.findUnique({
    where: { id: data.columnId },
    select: { boardId: true },
  });
  if (!col) throw new Error("Not found");
  await loadBoardAccess(col.boardId);
  await prisma.boardColumn.update({
    where: { id: data.columnId },
    data: { name: data.name },
  });
  revalidatePath(`/tasks/${col.boardId}`);
}

export async function deleteColumnAction(formData: FormData) {
  const columnId = String(formData.get("columnId") ?? "");
  const col = await prisma.boardColumn.findUnique({
    where: { id: columnId },
    select: { boardId: true },
  });
  if (!col) throw new Error("Not found");
  const access = await loadBoardAccess(col.boardId);
  if (!canManageBoard(access)) throw new Error("Forbidden");
  await prisma.boardColumn.delete({ where: { id: columnId } });
  revalidatePath(`/tasks/${col.boardId}`);
}

// -----------------------------
// Cards
// -----------------------------

const cardCreateSchema = z.object({
  columnId: z.string().min(1),
  title: z.string().trim().min(1).max(200),
});

export async function addCardAction(formData: FormData) {
  const user = await requireUser();
  const data = cardCreateSchema.parse({
    columnId: formData.get("columnId"),
    title: formData.get("title"),
  });
  const col = await prisma.boardColumn.findUnique({
    where: { id: data.columnId },
    select: { boardId: true, name: true },
  });
  if (!col) throw new Error("Not found");
  await loadBoardAccess(col.boardId);
  const last = await prisma.taskCard.findFirst({
    where: { columnId: data.columnId },
    orderBy: { position: "desc" },
    select: { position: true },
  });
  const card = await prisma.taskCard.create({
    data: {
      columnId: data.columnId,
      title: data.title,
      position: (last?.position ?? -1) + 1,
      createdById: user.id,
    },
  });
  await prisma.taskCardMoveEvent.create({
    data: {
      cardId: card.id,
      cardTitle: card.title,
      boardId: col.boardId,
      toColumnName: col.name,
      userId: user.id,
    },
  });
  revalidatePath(`/tasks/${col.boardId}`);
}

const cardUpdateSchema = z.object({
  cardId: z.string().min(1),
  title: z.string().trim().min(1).max(200).optional(),
  description: z.string().trim().max(20_000).optional().nullable(),
  priority: z.enum(["low", "normal", "high", "critical"]).optional(),
  deadline: z.string().optional().nullable(),
});

export async function updateCardAction(formData: FormData) {
  const data = cardUpdateSchema.parse({
    cardId: formData.get("cardId"),
    title: formData.get("title") ?? undefined,
    description: formData.has("description") ? formData.get("description") : undefined,
    priority: formData.get("priority") ?? undefined,
    deadline: formData.has("deadline") ? formData.get("deadline") : undefined,
  });
  const card = await prisma.taskCard.findUnique({
    where: { id: data.cardId },
    select: { column: { select: { boardId: true } } },
  });
  if (!card) throw new Error("Not found");
  await loadBoardAccess(card.column.boardId);

  let deadline: Date | null | undefined = undefined;
  if (data.deadline === null || data.deadline === "") deadline = null;
  else if (data.deadline) {
    const d = new Date(data.deadline);
    deadline = Number.isNaN(d.getTime()) ? undefined : d;
  }

  await prisma.taskCard.update({
    where: { id: data.cardId },
    data: {
      title: data.title,
      description: data.description ?? undefined,
      priority: data.priority,
      deadline,
    },
  });
  revalidatePath(`/tasks/${card.column.boardId}`);
  revalidatePath(`/tasks/${card.column.boardId}/cards/${data.cardId}`);
}

export async function deleteCardAction(formData: FormData) {
  const cardId = String(formData.get("cardId") ?? "");
  const card = await prisma.taskCard.findUnique({
    where: { id: cardId },
    select: { column: { select: { boardId: true } } },
  });
  if (!card) throw new Error("Not found");
  await loadBoardAccess(card.column.boardId);
  await prisma.taskCard.delete({ where: { id: cardId } });
  revalidatePath(`/tasks/${card.column.boardId}`);
  redirect(`/tasks/${card.column.boardId}`);
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
  if (!card) throw new Error("Not found");
  const access = await loadBoardAccess(card.column.boardId);

  const toCol = await prisma.boardColumn.findUnique({
    where: { id: data.toColumnId },
    select: { name: true, boardId: true },
  });
  if (!toCol || toCol.boardId !== card.column.boardId) throw new Error("Forbidden");
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

  revalidatePath(`/tasks/${card.column.boardId}`);
}

// -----------------------------
// Assignees
// -----------------------------

const assigneeSchema = z.object({
  cardId: z.string().min(1),
  userId: z.string().min(1),
});

export async function toggleAssigneeAction(formData: FormData) {
  const data = assigneeSchema.parse({
    cardId: formData.get("cardId"),
    userId: formData.get("userId"),
  });
  const card = await prisma.taskCard.findUnique({
    where: { id: data.cardId },
    select: { column: { select: { boardId: true } } },
  });
  if (!card) throw new Error("Not found");
  await loadBoardAccess(card.column.boardId);
  const existing = await prisma.taskCardAssignee.findUnique({
    where: { cardId_userId: { cardId: data.cardId, userId: data.userId } },
  });
  if (existing) {
    await prisma.taskCardAssignee.delete({
      where: { cardId_userId: { cardId: data.cardId, userId: data.userId } },
    });
  } else {
    await prisma.taskCardAssignee.create({
      data: { cardId: data.cardId, userId: data.userId },
    });
  }
  revalidatePath(`/tasks/${card.column.boardId}`);
  revalidatePath(`/tasks/${card.column.boardId}/cards/${data.cardId}`);
}

// -----------------------------
// Subtasks
// -----------------------------

export async function addSubtaskAction(formData: FormData) {
  const cardId = String(formData.get("cardId") ?? "");
  const title = String(formData.get("title") ?? "").trim();
  if (!cardId || !title) throw new Error("Invalid input");
  const card = await prisma.taskCard.findUnique({
    where: { id: cardId },
    select: { column: { select: { boardId: true } } },
  });
  if (!card) throw new Error("Not found");
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
}

export async function toggleSubtaskAction(formData: FormData) {
  const user = await requireUser();
  const subtaskId = String(formData.get("subtaskId") ?? "");
  const sub = await prisma.taskSubtask.findUnique({
    where: { id: subtaskId },
    select: { done: true, cardId: true, card: { select: { column: { select: { boardId: true } } } } },
  });
  if (!sub) throw new Error("Not found");
  await loadBoardAccess(sub.card.column.boardId);
  const newDone = !sub.done;
  await prisma.taskSubtask.update({
    where: { id: subtaskId },
    data: {
      done: newDone,
      completedAt: newDone ? new Date() : null,
      completedById: newDone ? user.id : null,
    },
  });
  revalidatePath(`/tasks/${sub.card.column.boardId}/cards/${sub.cardId}`);
}

export async function renameSubtaskAction(formData: FormData) {
  const subtaskId = String(formData.get("subtaskId") ?? "");
  const title = String(formData.get("title") ?? "").trim().slice(0, 200);
  if (!subtaskId || !title) throw new Error("Invalid input");
  const sub = await prisma.taskSubtask.findUnique({
    where: { id: subtaskId },
    select: { cardId: true, card: { select: { column: { select: { boardId: true } } } } },
  });
  if (!sub) throw new Error("Not found");
  await loadBoardAccess(sub.card.column.boardId);
  await prisma.taskSubtask.update({ where: { id: subtaskId }, data: { title } });
  revalidatePath(`/tasks/${sub.card.column.boardId}/cards/${sub.cardId}`);
}

export async function deleteSubtaskAction(formData: FormData) {
  const subtaskId = String(formData.get("subtaskId") ?? "");
  const sub = await prisma.taskSubtask.findUnique({
    where: { id: subtaskId },
    select: { cardId: true, card: { select: { column: { select: { boardId: true } } } } },
  });
  if (!sub) throw new Error("Not found");
  await loadBoardAccess(sub.card.column.boardId);
  await prisma.taskSubtask.delete({ where: { id: subtaskId } });
  revalidatePath(`/tasks/${sub.card.column.boardId}/cards/${sub.cardId}`);
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
  const data = tagCreateSchema.parse({
    boardId: formData.get("boardId"),
    name: formData.get("name"),
    color: formData.get("color"),
  });
  const access = await loadBoardAccess(data.boardId);
  if (!canManageBoard(access)) throw new Error("Forbidden");
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
}

export async function deleteBoardTagAction(formData: FormData) {
  const tagId = String(formData.get("tagId") ?? "");
  const tag = await prisma.boardTag.findUnique({
    where: { id: tagId },
    select: { boardId: true },
  });
  if (!tag) throw new Error("Not found");
  const access = await loadBoardAccess(tag.boardId);
  if (!canManageBoard(access)) throw new Error("Forbidden");
  await prisma.boardTag.delete({ where: { id: tagId } });
  revalidatePath(`/tasks/${tag.boardId}/settings`);
  revalidatePath(`/tasks/${tag.boardId}`);
}

export async function toggleCardTagAction(formData: FormData) {
  const cardId = String(formData.get("cardId") ?? "");
  const tagId = String(formData.get("tagId") ?? "");
  const card = await prisma.taskCard.findUnique({
    where: { id: cardId },
    select: { column: { select: { boardId: true } } },
  });
  const tag = await prisma.boardTag.findUnique({
    where: { id: tagId },
    select: { boardId: true },
  });
  if (!card || !tag || tag.boardId !== card.column.boardId) throw new Error("Not found");
  await loadBoardAccess(card.column.boardId);
  const existing = await prisma.taskCardTag.findUnique({
    where: { cardId_tagId: { cardId, tagId } },
  });
  if (existing) {
    await prisma.taskCardTag.delete({ where: { cardId_tagId: { cardId, tagId } } });
  } else {
    await prisma.taskCardTag.create({ data: { cardId, tagId } });
  }
  revalidatePath(`/tasks/${card.column.boardId}`);
  revalidatePath(`/tasks/${card.column.boardId}/cards/${cardId}`);
}

// -----------------------------
// Comments
// -----------------------------

export async function addCommentAction(formData: FormData) {
  const user = await requireUser();
  const cardId = String(formData.get("cardId") ?? "");
  const body = String(formData.get("body") ?? "").trim();
  if (!cardId || !body) throw new Error("Invalid input");
  const card = await prisma.taskCard.findUnique({
    where: { id: cardId },
    select: { column: { select: { boardId: true } } },
  });
  if (!card) throw new Error("Not found");
  await loadBoardAccess(card.column.boardId);
  await prisma.taskCardComment.create({
    data: {
      cardId,
      authorId: user.id,
      body: body.slice(0, 5000),
    },
  });
  revalidatePath(`/tasks/${card.column.boardId}/cards/${cardId}`);
}

export async function deleteCommentAction(formData: FormData) {
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
  if (!comment) throw new Error("Not found");
  const access = await loadBoardAccess(comment.card.column.boardId);
  if (comment.authorId !== user.id && !canManageBoard(access)) throw new Error("Forbidden");
  await prisma.taskCardComment.delete({ where: { id: commentId } });
  revalidatePath(`/tasks/${comment.card.column.boardId}/cards/${comment.cardId}`);
}

// -----------------------------
// Blocking
// -----------------------------

export async function addBlockAction(formData: FormData) {
  const user = await requireUser();
  const blockerId = String(formData.get("blockerId") ?? "");
  const blockedId = String(formData.get("blockedId") ?? "");
  if (!blockerId || !blockedId || blockerId === blockedId) throw new Error("Invalid input");
  const [a, b] = await Promise.all([
    prisma.taskCard.findUnique({
      where: { id: blockerId },
      select: { column: { select: { boardId: true } } },
    }),
    prisma.taskCard.findUnique({
      where: { id: blockedId },
      select: { column: { select: { boardId: true } } },
    }),
  ]);
  if (!a || !b) throw new Error("Not found");
  if (a.column.boardId !== b.column.boardId) throw new Error("Cards must be on the same board.");
  await loadBoardAccess(a.column.boardId);
  await prisma.taskBlock.upsert({
    where: { blockerId_blockedId: { blockerId, blockedId } },
    update: {},
    create: { blockerId, blockedId, createdById: user.id },
  });
  revalidatePath(`/tasks/${a.column.boardId}/cards/${blockedId}`);
  revalidatePath(`/tasks/${a.column.boardId}/cards/${blockerId}`);
}

export async function removeBlockAction(formData: FormData) {
  const blockId = String(formData.get("blockId") ?? "");
  const block = await prisma.taskBlock.findUnique({
    where: { id: blockId },
    select: {
      blockerId: true,
      blockedId: true,
      blocked: { select: { column: { select: { boardId: true } } } },
    },
  });
  if (!block) throw new Error("Not found");
  await loadBoardAccess(block.blocked.column.boardId);
  await prisma.taskBlock.delete({ where: { id: blockId } });
  revalidatePath(`/tasks/${block.blocked.column.boardId}/cards/${block.blockedId}`);
  revalidatePath(`/tasks/${block.blocked.column.boardId}/cards/${block.blockerId}`);
}

export async function whoami() {
  return await auth();
}
