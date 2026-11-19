import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db-local";
import { PALETTE } from "@/lib/palette";
import type { ImportBoard } from "@/lib/transfer/format";
import type { CsvPlan } from "@/lib/transfer/csv-import";
import { automationFromExport } from "@/lib/automations";

// Writes imported boards and CSV rows. Every import runs in one transaction:
// a file either lands completely or not at all. Server-only.

type Tx = Prisma.TransactionClient;

/** Imports can be large; give the transaction room (defaults are 5 seconds). */
export const IMPORT_TX = { timeout: 120_000, maxWait: 10_000 } as const;

export interface Importer {
  id: string;
  username: string;
}

export interface BoardImportStats {
  columns: number;
  cards: number;
  comments: number;
  checklistItems: number;
  tags: number;
  members: number;
  /** Usernames in the file with no active Kanbun user: left out. */
  unmatchedUsers: string[];
}

type UserIndex = Map<string, { id: string; active: boolean }>;

async function userIndex(tx: Tx): Promise<UserIndex> {
  const users = await tx.user.findMany({ select: { id: true, username: true, deactivatedAt: true } });
  return new Map(users.map((u) => [u.username.toLowerCase(), { id: u.id, active: !u.deactivatedAt }]));
}

const clip = (s: string, max: number) => (s.length > max ? s.slice(0, max) : s);
const tagKey = (name: string) => clip(name.trim(), 40).toLowerCase();
const dayDate = (d: string | null | undefined) => (d ? new Date(`${d}T00:00:00.000Z`) : null);
const parseDate = (d: string | null | undefined) => {
  if (!d) return undefined;
  const date = new Date(d);
  return Number.isNaN(date.getTime()) ? undefined : date;
};

/**
 * Creates one board from validated export data, owned by the importer.
 * `originallyBy` formats the prefix of comments whose author is not a user here.
 */
export async function writeBoard(
  tx: Tx,
  board: ImportBoard,
  importer: Importer,
  opts: { originallyBy: (name: string, date: string) => string; users?: UserIndex }
): Promise<{ boardId: string; stats: BoardImportStats }> {
  const users = opts.users ?? (await userIndex(tx));
  const unmatched = new Set<string>();
  const memberRoles = new Map<string, "owner" | "member">([[importer.id, "owner"]]);

  /** Resolves a username to an active user and makes them a board member. */
  const member = (username: string | null | undefined, role: "owner" | "member" = "member"): string | null => {
    if (!username) return null;
    const user = users.get(username.toLowerCase());
    if (!user || !user.active) {
      unmatched.add(username.toLowerCase());
      return null;
    }
    const current = memberRoles.get(user.id);
    if (current !== "owner") memberRoles.set(user.id, role === "owner" ? "owner" : (current ?? "member"));
    return user.id;
  };
  /** Any user (deactivated ones too) for authorship, without membership. */
  const author = (username: string | null | undefined): string | null =>
    username ? (users.get(username.toLowerCase())?.id ?? null) : null;

  for (const m of board.members) member(m.username, m.role);

  const category = board.category
    ? await tx.boardCategory.findFirst({ where: { name: board.category }, select: { id: true } })
    : null;
  const last = await tx.board.findFirst({
    where: { categoryId: category?.id ?? null },
    orderBy: { position: "desc" },
    select: { position: true },
  });

  const created = await tx.board.create({
    data: {
      name: clip(board.name, 120),
      description: board.description ? clip(board.description, 2000) : null,
      color: board.color,
      archived: board.archived,
      categoryId: category?.id ?? null,
      position: (last?.position ?? -1) + 1,
      createdById: importer.id,
    },
    select: { id: true },
  });
  const boardId = created.id;

  // Tags: the board's own list first, then any name only used on a card.
  const tagIds = new Map<string, string>();
  const ensureTag = async (name: string, color?: string) => {
    const key = tagKey(name);
    if (!key || tagIds.has(key)) return;
    const tag = await tx.boardTag.create({
      data: { boardId, name: clip(name.trim(), 40), color: color ?? PALETTE[tagIds.size % PALETTE.length], position: tagIds.size },
      select: { id: true },
    });
    tagIds.set(key, tag.id);
  };
  for (const tag of board.tags) await ensureTag(tag.name, tag.color);

  const stats: BoardImportStats = {
    columns: 0,
    cards: 0,
    comments: 0,
    checklistItems: 0,
    tags: 0,
    members: 0,
    unmatchedUsers: [],
  };
  const newIdByFileId = new Map<string, string>();
  const blocks: { from: string; to: string }[] = [];
  const activity: Prisma.CardActivityCreateManyInput[] = [];

  for (const [colIndex, col] of board.columns.entries()) {
    const column = await tx.boardColumn.create({
      data: { boardId, name: clip(col.name, 80), position: colIndex, wipLimit: col.wipLimit ?? null },
      select: { id: true },
    });
    stats.columns += 1;
    for (const [position, card] of col.cards.entries()) {
      for (const name of card.tags) await ensureTag(name);
      const assigneeIds = Array.from(new Set(card.assignees.map((u) => member(u)).filter((id): id is string => !!id)));
      const createdAt = parseDate(card.createdAt);
      const row = await tx.taskCard.create({
        data: {
          columnId: column.id,
          title: clip(card.title, 200),
          description: card.description ? clip(card.description, 20_000) : null,
          position,
          priority: card.priority,
          coverColor: card.coverColor ?? null,
          deadline: dayDate(card.deadline),
          createdById: author(card.createdBy) ?? importer.id,
          ...(createdAt ? { createdAt } : {}),
          tags: {
            create: Array.from(new Set(card.tags.map((n) => tagIds.get(tagKey(n))).filter((id): id is string => !!id))).map(
              (tagId) => ({ tagId })
            ),
          },
          assignees: { create: assigneeIds.map((userId) => ({ userId })) },
          subtasks: {
            create: card.checklist.map((item, i) => ({
              title: clip(item.title, 500),
              done: item.done,
              position: i,
              completedAt: item.done ? new Date() : null,
              dueDate: dayDate(item.dueDate),
              assigneeId: member(item.assignee),
            })),
          },
          comments: {
            create: card.comments.map((c) => {
              const authorId = author(c.author);
              const createdAt = parseDate(c.createdAt);
              // Unknown authors: the importer posts it, with the original author named.
              const body =
                authorId || !(c.authorName || c.author)
                  ? c.body
                  : `${opts.originallyBy(c.authorName || c.author || "", c.createdAt.slice(0, 10))}\n\n${c.body}`;
              return { authorId: authorId ?? importer.id, body: clip(body, 20_000), ...(createdAt ? { createdAt } : {}) };
            }),
          },
        },
        select: { id: true },
      });
      newIdByFileId.set(card.id, row.id);
      for (const to of card.blocks) blocks.push({ from: card.id, to });
      stats.cards += 1;
      stats.comments += card.comments.length;
      stats.checklistItems += card.checklist.length;

      if (card.activity?.length) {
        for (const a of card.activity) {
          const data = JSON.stringify(a.data);
          activity.push({
            cardId: row.id,
            boardId,
            type: a.type,
            data: data.length <= 4000 ? data : "{}",
            actorId: author(a.actor),
            createdAt: parseDate(a.createdAt),
          });
        }
      } else {
        activity.push({
          cardId: row.id,
          boardId,
          type: "created",
          data: JSON.stringify({ column: clip(col.name, 80) }),
          actorId: importer.id,
        });
      }
    }
  }

  const seen = new Set<string>();
  const blockRows: Prisma.TaskBlockCreateManyInput[] = [];
  for (const b of blocks) {
    const blockerId = newIdByFileId.get(b.from);
    const blockedId = newIdByFileId.get(b.to);
    const key = `${blockerId}:${blockedId}`;
    if (!blockerId || !blockedId || blockerId === blockedId || seen.has(key)) continue;
    seen.add(key);
    blockRows.push({ blockerId, blockedId, createdById: importer.id });
  }
  if (blockRows.length) await tx.taskBlock.createMany({ data: blockRows });
  for (let i = 0; i < activity.length; i += 500) {
    await tx.cardActivity.createMany({ data: activity.slice(i, i + 500) });
  }

  for (const tpl of board.templates) {
    await tx.cardTemplate.create({
      data: {
        boardId,
        name: clip(tpl.name, 80),
        title: clip(tpl.title, 200),
        description: tpl.description ? clip(tpl.description, 20_000) : null,
        priority: tpl.priority,
        tagIds: JSON.stringify(tpl.tags.map((n) => tagIds.get(tagKey(n))).filter(Boolean)),
        checklist: JSON.stringify(tpl.checklist.map((s) => clip(s, 500))),
        createdById: importer.id,
      },
    });
  }

  // Automation rules: by column, tag and member name on the new board.
  const columnIdByName = new Map<string, string>();
  for (const col of await tx.boardColumn.findMany({ where: { boardId }, orderBy: { position: "asc" } })) {
    if (!columnIdByName.has(col.name.toLowerCase())) columnIdByName.set(col.name.toLowerCase(), col.id);
  }
  for (const exp of board.automations) {
    const rule = automationFromExport(
      { ...exp, column: exp.column ?? null },
      {
        column: (name) => columnIdByName.get(name.toLowerCase()),
        tag: (name) => tagIds.get(tagKey(name)),
        // Only people who are members of the imported board anyway.
        user: (username) => {
          const user = users.get(username.toLowerCase());
          return user?.active && memberRoles.has(user.id) ? user.id : undefined;
        },
      }
    );
    if (!rule) continue;
    await tx.automationRule.create({
      data: {
        boardId,
        name: rule.name,
        trigger: rule.trigger,
        columnId: rule.columnId,
        actions: JSON.stringify(rule.actions),
        enabled: rule.enabled,
        createdById: importer.id,
      },
    });
  }

  await tx.boardMember.createMany({
    data: Array.from(memberRoles, ([userId, role]) => ({ boardId, userId, role })),
  });

  stats.tags = tagIds.size;
  stats.members = memberRoles.size;
  stats.unmatchedUsers = Array.from(unmatched).sort();
  return { boardId, stats };
}

/** Imports every board of a validated export in one transaction. */
export async function importBoards(
  boards: ImportBoard[],
  importer: Importer,
  originallyBy: (name: string, date: string) => string
) {
  return prisma.$transaction(async (tx) => {
    const users = await userIndex(tx);
    const results = [];
    for (const board of boards) results.push(await writeBoard(tx, board, importer, { originallyBy, users }));
    return results;
  }, IMPORT_TX);
}

export interface CsvImportResult {
  cards: number;
  newColumns: number;
  newTags: number;
}

/** Adds planned CSV rows to the end of their columns, creating missing columns and tags. */
export async function writeCsvPlan(boardId: string, plan: CsvPlan, importer: Importer): Promise<CsvImportResult> {
  return prisma.$transaction(async (tx) => {
    const columns = await tx.boardColumn.findMany({ where: { boardId }, orderBy: { position: "asc" } });
    const columnIds = new Map(columns.map((c) => [c.name.toLowerCase(), c.id]));
    let nextColumnPos = (columns.at(-1)?.position ?? -1) + 1;
    let newColumns = 0;
    const columnId = async (name: string) => {
      const key = name.toLowerCase();
      const existing = columnIds.get(key);
      if (existing) return existing;
      const col = await tx.boardColumn.create({ data: { boardId, name, position: nextColumnPos++ }, select: { id: true } });
      columnIds.set(key, col.id);
      newColumns += 1;
      return col.id;
    };

    const tags = await tx.boardTag.findMany({ where: { boardId }, orderBy: { position: "asc" } });
    const tagIds = new Map(tags.map((t) => [t.name.toLowerCase(), t.id]));
    let nextTagPos = (tags.at(-1)?.position ?? -1) + 1;
    let newTags = 0;
    const tagId = async (name: string) => {
      const key = name.toLowerCase();
      const existing = tagIds.get(key);
      if (existing) return existing;
      const tag = await tx.boardTag.create({
        data: { boardId, name, color: PALETTE[(tags.length + newTags) % PALETTE.length], position: nextTagPos++ },
        select: { id: true },
      });
      tagIds.set(key, tag.id);
      newTags += 1;
      return tag.id;
    };

    // Only current board members can be assigned (the plan already checked;
    // this guards against a member removed between preview and import).
    const members = await tx.boardMember.findMany({
      where: { boardId, user: { deactivatedAt: null } },
      select: { userId: true, user: { select: { username: true } } },
    });
    const memberIds = new Map(members.map((m) => [m.user.username.toLowerCase(), m.userId]));

    const nextPos = new Map<string, number>();
    const activity: Prisma.CardActivityCreateManyInput[] = [];
    for (const card of plan.cards) {
      const colId = await columnId(card.column);
      if (!nextPos.has(colId)) {
        const lastCard = await tx.taskCard.findFirst({
          where: { columnId: colId },
          orderBy: { position: "desc" },
          select: { position: true },
        });
        nextPos.set(colId, (lastCard?.position ?? -1) + 1);
      }
      const position = nextPos.get(colId)!;
      nextPos.set(colId, position + 1);
      const cardTagIds: string[] = [];
      for (const name of card.tags) cardTagIds.push(await tagId(name));
      const row = await tx.taskCard.create({
        data: {
          columnId: colId,
          title: card.title,
          description: card.description,
          position,
          priority: card.priority,
          deadline: dayDate(card.deadline),
          createdById: importer.id,
          tags: { create: Array.from(new Set(cardTagIds)).map((id) => ({ tagId: id })) },
          assignees: {
            create: card.assignees
              .map((u) => memberIds.get(u))
              .filter((id): id is string => !!id)
              .map((userId) => ({ userId })),
          },
        },
        select: { id: true },
      });
      activity.push({
        cardId: row.id,
        boardId,
        type: "created",
        data: JSON.stringify({ column: card.column }),
        actorId: importer.id,
      });
    }
    for (let i = 0; i < activity.length; i += 500) {
      await tx.cardActivity.createMany({ data: activity.slice(i, i + 500) });
    }
    return { cards: plan.cards.length, newColumns, newTags };
  }, IMPORT_TX);
}
