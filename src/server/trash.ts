import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db-local";
import { ActionError } from "@/lib/action-result";
import { removeAttachmentFiles } from "@/server/attachment-storage";

// Deleting a card, column or board stores its whole subtree as a JSON
// snapshot in TrashItem and then removes the live rows. Restoring recreates
// the rows with their original ids. References that no longer exist (a user
// deleted since, a tag removed) are dropped or nulled instead of failing.

type Tx = Prisma.TransactionClient;

export const TRASH_RETENTION_DAYS = 30;
const RETENTION_MS = TRASH_RETENTION_DAYS * 24 * 60 * 60 * 1000;

/** Items deleted before this moment have expired. */
export function trashCutoff(): Date {
  return new Date(Date.now() - RETENTION_MS);
}

export type TrashKind = "card" | "column" | "board";

interface CardSnapshot {
  id: string;
  columnId: string;
  title: string;
  description: string | null;
  position: number;
  priority: string;
  coverColor: string | null;
  deadline: string | null;
  createdAt: string;
  createdById: string | null;
  assigneeIds: string[];
  tagIds: string[];
  subtasks: {
    id: string;
    title: string;
    done: boolean;
    position: number;
    createdAt: string;
    completedAt: string | null;
    completedById: string | null;
    // Added in v0.6; older snapshots lack them.
    assigneeId?: string | null;
    dueDate?: string | null;
  }[];
  /** Metadata only: the files stay on disk until the trash item is purged. Added in v0.6. */
  attachments?: {
    id: string;
    uploaderId: string | null;
    fileName: string;
    mimeType: string;
    size: number;
    storageKey: string;
    width: number | null;
    height: number | null;
    createdAt: string;
  }[];
  comments: { id: string; authorId: string | null; body: string; createdAt: string }[];
  blocks: { id: string; blockerId: string; blockedId: string; createdAt: string; createdById: string | null }[];
  /** Missing in snapshots taken before watchers existed. */
  watcherIds?: string[];
}

interface ColumnSnapshot {
  id: string;
  boardId: string;
  name: string;
  position: number;
  wipLimit: number | null;
  cards: CardSnapshot[];
}

interface BoardSnapshot {
  id: string;
  name: string;
  description: string | null;
  color: string;
  position: number;
  archived: boolean;
  createdAt: string;
  createdById: string | null;
  categoryId: string | null;
  members: { userId: string; role: string; addedAt: string }[];
  tags: { id: string; name: string; color: string; position: number; createdAt: string }[];
  columns: ColumnSnapshot[];
  /** Missing in snapshots taken before watchers existed. */
  watcherIds?: string[];
}

const cardInclude = {
  assignees: { select: { userId: true } },
  tags: { select: { tagId: true } },
  subtasks: true,
  comments: true,
  blocking: true,
  blockedBy: true,
  watchers: { select: { userId: true } },
  attachments: true,
} satisfies Prisma.TaskCardInclude;

type CardWithRelations = Prisma.TaskCardGetPayload<{ include: typeof cardInclude }>;

const iso = (d: Date | null) => (d ? d.toISOString() : null);

function snapshotCard(card: CardWithRelations): CardSnapshot {
  const blocks = new Map<string, CardSnapshot["blocks"][number]>();
  for (const b of [...card.blocking, ...card.blockedBy]) {
    blocks.set(b.id, {
      id: b.id,
      blockerId: b.blockerId,
      blockedId: b.blockedId,
      createdAt: b.createdAt.toISOString(),
      createdById: b.createdById,
    });
  }
  return {
    id: card.id,
    columnId: card.columnId,
    title: card.title,
    description: card.description,
    position: card.position,
    priority: card.priority,
    coverColor: card.coverColor,
    deadline: iso(card.deadline),
    createdAt: card.createdAt.toISOString(),
    createdById: card.createdById,
    assigneeIds: card.assignees.map((a) => a.userId),
    tagIds: card.tags.map((t) => t.tagId),
    subtasks: card.subtasks.map((s) => ({
      id: s.id,
      title: s.title,
      done: s.done,
      position: s.position,
      createdAt: s.createdAt.toISOString(),
      completedAt: iso(s.completedAt),
      completedById: s.completedById,
      assigneeId: s.assigneeId,
      dueDate: iso(s.dueDate),
    })),
    attachments: card.attachments.map((a) => ({
      id: a.id,
      uploaderId: a.uploaderId,
      fileName: a.fileName,
      mimeType: a.mimeType,
      size: a.size,
      storageKey: a.storageKey,
      width: a.width,
      height: a.height,
      createdAt: a.createdAt.toISOString(),
    })),
    comments: card.comments.map((c) => ({
      id: c.id,
      authorId: c.authorId,
      body: c.body,
      createdAt: c.createdAt.toISOString(),
    })),
    blocks: [...blocks.values()],
    watcherIds: card.watchers.map((w) => w.userId),
  };
}

/** Storage keys of the attachment files held by a trash item's snapshot. */
export function snapshotStorageKeys(kind: string, payload: string): string[] {
  try {
    const snap = JSON.parse(payload) as CardSnapshot | ColumnSnapshot | BoardSnapshot;
    const cards: CardSnapshot[] =
      kind === "card"
        ? [snap as CardSnapshot]
        : kind === "column"
          ? (snap as ColumnSnapshot).cards
          : (snap as BoardSnapshot).columns.flatMap((c) => c.cards);
    return cards.flatMap((c) => (c.attachments ?? []).map((a) => a.storageKey));
  } catch {
    return [];
  }
}

// Expired items are dropped inside the caller's transaction; their files are
// removed once it has committed (see withPurge), so a rollback keeps them.
async function purgeExpired(tx: Tx): Promise<string[]> {
  const expired = await tx.trashItem.findMany({
    where: { deletedAt: { lt: trashCutoff() } },
    select: { id: true, kind: true, payload: true },
  });
  if (expired.length === 0) return [];
  await tx.trashItem.deleteMany({ where: { id: { in: expired.map((e) => e.id) } } });
  return expired.flatMap((e) => snapshotStorageKeys(e.kind, e.payload));
}

async function withPurge(run: (tx: Tx) => Promise<string>): Promise<string> {
  let keys: string[] = [];
  const id = await prisma.$transaction(async (tx) => {
    const result = await run(tx);
    keys = await purgeExpired(tx);
    return result;
  });
  if (keys.length) await removeAttachmentFiles(keys);
  return id;
}

export async function trashCard(cardId: string, userId: string): Promise<string> {
  return withPurge(async (tx) => {
    const card = await tx.taskCard.findUnique({
      where: { id: cardId },
      include: { ...cardInclude, column: { select: { boardId: true } } },
    });
    if (!card) throw new ActionError("notFound");
    const item = await tx.trashItem.create({
      data: {
        kind: "card",
        entityId: card.id,
        boardId: card.column.boardId,
        label: card.title,
        payload: JSON.stringify(snapshotCard(card)),
        deletedById: userId,
      },
    });
    await tx.taskCard.delete({ where: { id: cardId } });
    return item.id;
  });
}

export async function trashColumn(columnId: string, userId: string): Promise<string> {
  return withPurge(async (tx) => {
    const col = await tx.boardColumn.findUnique({
      where: { id: columnId },
      include: { cards: { include: cardInclude, orderBy: { position: "asc" } } },
    });
    if (!col) throw new ActionError("notFound");
    const snapshot: ColumnSnapshot = {
      id: col.id,
      boardId: col.boardId,
      name: col.name,
      position: col.position,
      wipLimit: col.wipLimit,
      cards: col.cards.map(snapshotCard),
    };
    const item = await tx.trashItem.create({
      data: {
        kind: "column",
        entityId: col.id,
        boardId: col.boardId,
        label: col.name,
        payload: JSON.stringify(snapshot),
        deletedById: userId,
      },
    });
    await tx.boardColumn.delete({ where: { id: columnId } });
    return item.id;
  });
}

export async function trashBoard(boardId: string, userId: string): Promise<string> {
  return withPurge(async (tx) => {
    const board = await tx.board.findUnique({
      where: { id: boardId },
      include: {
        members: true,
        tags: true,
        watchers: { select: { userId: true } },
        columns: {
          orderBy: { position: "asc" },
          include: { cards: { include: cardInclude, orderBy: { position: "asc" } } },
        },
      },
    });
    if (!board) throw new ActionError("notFound");
    const snapshot: BoardSnapshot = {
      id: board.id,
      name: board.name,
      description: board.description,
      color: board.color,
      position: board.position,
      archived: board.archived,
      createdAt: board.createdAt.toISOString(),
      createdById: board.createdById,
      categoryId: board.categoryId,
      members: board.members.map((m) => ({ userId: m.userId, role: m.role, addedAt: m.addedAt.toISOString() })),
      tags: board.tags.map((t) => ({
        id: t.id,
        name: t.name,
        color: t.color,
        position: t.position,
        createdAt: t.createdAt.toISOString(),
      })),
      columns: board.columns.map((c) => ({
        id: c.id,
        boardId: c.boardId,
        name: c.name,
        position: c.position,
        wipLimit: c.wipLimit,
        cards: c.cards.map(snapshotCard),
      })),
      watcherIds: board.watchers.map((w) => w.userId),
    };
    const item = await tx.trashItem.create({
      data: {
        kind: "board",
        entityId: board.id,
        boardId: board.id,
        label: board.name,
        payload: JSON.stringify(snapshot),
        deletedById: userId,
      },
    });
    await tx.board.delete({ where: { id: boardId } });
    return item.id;
  });
}

/** Board owners recorded in a board snapshot (they may restore the board). */
export function boardSnapshotOwners(payload: string): string[] {
  const snap = JSON.parse(payload) as BoardSnapshot;
  return snap.members.filter((m) => m.role === "owner").map((m) => m.userId);
}

async function existingIds(
  ids: Iterable<string | null>,
  find: (ids: string[]) => Promise<{ id: string }[]>
): Promise<Set<string>> {
  const list = [...new Set([...ids].filter((v): v is string => !!v))];
  if (list.length === 0) return new Set();
  return new Set((await find(list)).map((r) => r.id));
}

async function restoreCards(tx: Tx, cards: CardSnapshot[], columnFor: (card: CardSnapshot) => string) {
  const users = await existingIds(
    cards.flatMap((c) => [
      c.createdById,
      ...c.assigneeIds,
      ...c.subtasks.flatMap((s) => [s.completedById, s.assigneeId ?? null]),
      ...(c.attachments ?? []).map((a) => a.uploaderId),
      ...c.comments.map((m) => m.authorId),
      ...c.blocks.map((b) => b.createdById),
      ...(c.watcherIds ?? []),
    ]),
    (ids) => tx.user.findMany({ where: { id: { in: ids } }, select: { id: true } })
  );
  const tags = await existingIds(cards.flatMap((c) => c.tagIds), (ids) =>
    tx.boardTag.findMany({ where: { id: { in: ids } }, select: { id: true } })
  );
  const keepUser = (id: string | null) => (id && users.has(id) ? id : null);

  for (const c of cards) {
    await tx.taskCard.create({
      data: {
        id: c.id,
        columnId: columnFor(c),
        title: c.title,
        description: c.description,
        position: c.position,
        priority: c.priority,
        coverColor: c.coverColor,
        deadline: c.deadline ? new Date(c.deadline) : null,
        createdAt: new Date(c.createdAt),
        createdById: keepUser(c.createdById),
        assignees: { create: c.assigneeIds.filter((id) => users.has(id)).map((userId) => ({ userId })) },
        tags: { create: c.tagIds.filter((id) => tags.has(id)).map((tagId) => ({ tagId })) },
        watchers: { create: (c.watcherIds ?? []).filter((id) => users.has(id)).map((userId) => ({ userId })) },
        subtasks: {
          create: c.subtasks.map((s) => ({
            id: s.id,
            title: s.title,
            done: s.done,
            position: s.position,
            createdAt: new Date(s.createdAt),
            completedAt: s.completedAt ? new Date(s.completedAt) : null,
            completedById: keepUser(s.completedById),
            assigneeId: keepUser(s.assigneeId ?? null),
            dueDate: s.dueDate ? new Date(s.dueDate) : null,
          })),
        },
        attachments: {
          create: (c.attachments ?? []).map((a) => ({
            id: a.id,
            uploaderId: keepUser(a.uploaderId),
            fileName: a.fileName,
            mimeType: a.mimeType,
            size: a.size,
            storageKey: a.storageKey,
            width: a.width,
            height: a.height,
            createdAt: new Date(a.createdAt),
          })),
        },
        comments: {
          create: c.comments.map((m) => ({
            id: m.id,
            authorId: keepUser(m.authorId),
            body: m.body,
            createdAt: new Date(m.createdAt),
          })),
        },
      },
    });
  }

  // Blocks last: both ends must exist, and the other end may be a card that
  // is still on the board or one restored in this same batch.
  const blocks = new Map(cards.flatMap((c) => c.blocks).map((b) => [b.id, b]));
  const ends = await existingIds(
    [...blocks.values()].flatMap((b) => [b.blockerId, b.blockedId]),
    (ids) => tx.taskCard.findMany({ where: { id: { in: ids } }, select: { id: true } })
  );
  for (const b of blocks.values()) {
    if (!ends.has(b.blockerId) || !ends.has(b.blockedId)) continue;
    await tx.taskBlock.upsert({
      where: { blockerId_blockedId: { blockerId: b.blockerId, blockedId: b.blockedId } },
      update: {},
      create: {
        id: b.id,
        blockerId: b.blockerId,
        blockedId: b.blockedId,
        createdAt: new Date(b.createdAt),
        createdById: keepUser(b.createdById),
      },
    });
  }
}

async function restoreColumn(tx: Tx, col: ColumnSnapshot) {
  await tx.boardColumn.updateMany({
    where: { boardId: col.boardId, position: { gte: col.position } },
    data: { position: { increment: 1 } },
  });
  await tx.boardColumn.create({
    data: { id: col.id, boardId: col.boardId, name: col.name, position: col.position, wipLimit: col.wipLimit },
  });
  await restoreCards(tx, col.cards, () => col.id);
}

/** Restores a trash item and deletes it. Returns the board id it belongs to. */
export async function restoreTrashItem(item: { id: string; kind: string; boardId: string; payload: string }): Promise<string> {
  return prisma.$transaction(async (tx) => {
    let boardId: string;
    if (item.kind === "card") {
      const card = JSON.parse(item.payload) as CardSnapshot;
      const original = await tx.boardColumn.findUnique({ where: { id: card.columnId }, select: { id: true } });
      boardId = item.boardId;
      const board = await tx.board.findUnique({ where: { id: boardId }, select: { id: true } });
      if (!board) throw new ActionError("restoreBoardFirst");
      let columnId = original?.id;
      if (!columnId) {
        const first = await tx.boardColumn.findFirst({
          where: { boardId },
          orderBy: { position: "asc" },
          select: { id: true },
        });
        if (!first) throw new ActionError("noColumns");
        columnId = first.id;
      }
      await tx.taskCard.updateMany({
        where: { columnId, position: { gte: card.position } },
        data: { position: { increment: 1 } },
      });
      await restoreCards(tx, [card], () => columnId);
    } else if (item.kind === "column") {
      const col = JSON.parse(item.payload) as ColumnSnapshot;
      boardId = col.boardId;
      const board = await tx.board.findUnique({ where: { id: boardId }, select: { id: true } });
      if (!board) throw new ActionError("restoreBoardFirst");
      await restoreColumn(tx, col);
    } else {
      const b = JSON.parse(item.payload) as BoardSnapshot;
      boardId = b.id;
      const users = await existingIds(
        [b.createdById, ...b.members.map((m) => m.userId), ...(b.watcherIds ?? [])],
        (ids) => tx.user.findMany({ where: { id: { in: ids } }, select: { id: true } })
      );
      const category = b.categoryId
        ? await tx.boardCategory.findUnique({ where: { id: b.categoryId }, select: { id: true } })
        : null;
      await tx.board.updateMany({
        where: { categoryId: category?.id ?? null, position: { gte: b.position } },
        data: { position: { increment: 1 } },
      });
      await tx.board.create({
        data: {
          id: b.id,
          name: b.name,
          description: b.description,
          color: b.color,
          position: b.position,
          archived: b.archived,
          createdAt: new Date(b.createdAt),
          createdById: b.createdById && users.has(b.createdById) ? b.createdById : null,
          categoryId: category?.id ?? null,
          members: {
            create: b.members
              .filter((m) => users.has(m.userId))
              .map((m) => ({ userId: m.userId, role: m.role, addedAt: new Date(m.addedAt) })),
          },
          watchers: {
            create: (b.watcherIds ?? []).filter((id) => users.has(id)).map((userId) => ({ userId })),
          },
          tags: {
            create: b.tags.map((t) => ({
              id: t.id,
              name: t.name,
              color: t.color,
              position: t.position,
              createdAt: new Date(t.createdAt),
            })),
          },
        },
      });
      for (const col of b.columns) {
        await tx.boardColumn.create({
          data: { id: col.id, boardId: b.id, name: col.name, position: col.position, wipLimit: col.wipLimit },
        });
      }
      await restoreCards(tx, b.columns.flatMap((c) => c.cards), (card) => card.columnId);
    }
    await tx.trashItem.delete({ where: { id: item.id } });
    return boardId;
  });
}
