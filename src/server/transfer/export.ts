import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db-local";
import { toCsv } from "@/lib/csv";
import { APP_VERSION } from "@/lib/version";
import { EXPORT_FORMAT, EXPORT_VERSION, type ExportBoard, type ExportCard, type KanbunExport } from "@/lib/transfer/format";

// Builds the Kanbun export (format documented in docs/IMPORT-EXPORT.md) and
// the cards CSV from the database. Server-only.

const boardInclude = {
  category: { select: { name: true } },
  members: { orderBy: { addedAt: "asc" } },
  tags: { orderBy: { position: "asc" } },
  cardTemplates: { orderBy: { name: "asc" } },
  columns: {
    orderBy: { position: "asc" },
    include: {
      cards: {
        orderBy: { position: "asc" },
        include: {
          assignees: { select: { userId: true } },
          tags: { select: { tagId: true } },
          subtasks: { orderBy: { position: "asc" } },
          comments: { orderBy: { createdAt: "asc" } },
          blocking: { select: { blockedId: true } },
          attachments: { orderBy: { createdAt: "asc" } },
        },
      },
    },
  },
} satisfies Prisma.BoardInclude;

type BoardRow = Prisma.BoardGetPayload<{ include: typeof boardInclude }>;

const day = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);

function safeJson(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

async function userNames(): Promise<Map<string, string>> {
  const users = await prisma.user.findMany({ select: { id: true, username: true } });
  return new Map(users.map((u) => [u.id, u.username]));
}

async function activityByCard(cardIds: string[], names: Map<string, string>) {
  const map = new Map<string, NonNullable<ExportCard["activity"]>>();
  // Chunked: SQLite limits the number of bound parameters per query.
  for (let i = 0; i < cardIds.length; i += 500) {
    const rows = await prisma.cardActivity.findMany({
      where: { cardId: { in: cardIds.slice(i, i + 500) } },
      orderBy: { createdAt: "asc" },
    });
    for (const a of rows) {
      const list = map.get(a.cardId) ?? [];
      list.push({
        type: a.type,
        data: safeJson(a.data),
        actor: a.actorId ? (names.get(a.actorId) ?? null) : null,
        createdAt: a.createdAt.toISOString(),
      });
      map.set(a.cardId, list);
    }
  }
  return map;
}

async function toExportBoard(
  board: BoardRow,
  names: Map<string, string>,
  withActivity: boolean
): Promise<ExportBoard> {
  const tagName = new Map(board.tags.map((t) => [t.id, t.name]));
  const name = (id: string | null) => (id ? (names.get(id) ?? null) : null);
  const activity = withActivity
    ? await activityByCard(board.columns.flatMap((c) => c.cards.map((card) => card.id)), names)
    : null;
  return {
    name: board.name,
    description: board.description,
    color: board.color,
    archived: board.archived,
    category: board.category?.name ?? null,
    createdAt: board.createdAt.toISOString(),
    members: board.members.flatMap((m) => {
      const username = names.get(m.userId);
      return username ? [{ username, role: m.role === "owner" ? ("owner" as const) : ("member" as const) }] : [];
    }),
    tags: board.tags.map((t) => ({ name: t.name, color: t.color })),
    templates: board.cardTemplates.map((tpl) => {
      let tagIds: string[] = [];
      let checklist: string[] = [];
      try {
        tagIds = JSON.parse(tpl.tagIds);
        checklist = JSON.parse(tpl.checklist);
      } catch {
        // Stored by the app as JSON arrays; a broken row exports without them.
      }
      return {
        name: tpl.name,
        title: tpl.title,
        description: tpl.description,
        priority: tpl.priority as ExportCard["priority"],
        tags: tagIds.map((id) => tagName.get(id)).filter((n): n is string => !!n),
        checklist: checklist.filter((s) => typeof s === "string"),
      };
    }),
    columns: board.columns.map((col) => ({
      name: col.name,
      wipLimit: col.wipLimit,
      cards: col.cards.map((card): ExportCard => ({
        id: card.id,
        title: card.title,
        description: card.description,
        priority: card.priority as ExportCard["priority"],
        coverColor: card.coverColor,
        deadline: day(card.deadline),
        createdAt: card.createdAt.toISOString(),
        createdBy: name(card.createdById),
        tags: card.tags.map((t) => tagName.get(t.tagId)).filter((n): n is string => !!n),
        assignees: card.assignees.map((a) => names.get(a.userId)).filter((n): n is string => !!n),
        checklist: card.subtasks.map((s) => ({
          title: s.title,
          done: s.done,
          dueDate: day(s.dueDate),
          assignee: name(s.assigneeId),
        })),
        comments: card.comments.map((c) => ({
          author: name(c.authorId),
          body: c.body,
          createdAt: c.createdAt.toISOString(),
        })),
        blocks: card.blocking.map((b) => b.blockedId),
        attachments: card.attachments.map((a) => ({
          fileName: a.fileName,
          mimeType: a.mimeType,
          size: a.size,
          createdAt: a.createdAt.toISOString(),
        })),
        ...(activity ? { activity: activity.get(card.id) ?? [] } : {}),
      })),
    })),
  };
}

function envelope(kind: "board" | "full", boards: ExportBoard[]): KanbunExport {
  return {
    format: EXPORT_FORMAT,
    version: EXPORT_VERSION,
    kind,
    exportedAt: new Date().toISOString(),
    app: { name: "Kanbun", version: APP_VERSION },
    boards,
  };
}

/** One board as a Kanbun export, or null when it does not exist. */
export async function exportBoard(boardId: string, opts: { activity?: boolean } = {}): Promise<KanbunExport | null> {
  const board = await prisma.board.findUnique({ where: { id: boardId }, include: boardInclude });
  if (!board) return null;
  return envelope("board", [await toExportBoard(board, await userNames(), !!opts.activity)]);
}

/** Every board (archived ones too), users and categories. Admin only. */
export async function exportEverything(opts: { activity?: boolean } = {}): Promise<KanbunExport> {
  const names = await userNames();
  const boards = await prisma.board.findMany({
    include: boardInclude,
    orderBy: [{ position: "asc" }, { createdAt: "asc" }],
  });
  const out: ExportBoard[] = [];
  for (const board of boards) out.push(await toExportBoard(board, names, !!opts.activity));
  const users = await prisma.user.findMany({ orderBy: { createdAt: "asc" } });
  const categories = await prisma.boardCategory.findMany({ orderBy: { position: "asc" } });
  return {
    ...envelope("full", out),
    // Never password hashes or session data.
    users: users.map((u) => ({
      username: u.username,
      displayName: u.displayName,
      role: u.role,
      email: u.email,
      deactivated: !!u.deactivatedAt,
      createdAt: u.createdAt.toISOString(),
    })),
    categories: categories.map((c) => ({ name: c.name, color: c.color })),
  };
}

export const CSV_HEADERS = ["title", "description", "column", "priority", "deadline", "tags", "assignees", "checklist", "created"];

/** Cards of a board as CSV, with the columns the CSV import reads back. */
export function boardCardsCsv(data: KanbunExport): string {
  const board = data.boards[0];
  const rows: unknown[][] = [CSV_HEADERS];
  for (const col of board.columns) {
    for (const card of col.cards ?? []) {
      const checklist = card.checklist ?? [];
      rows.push([
        card.title,
        card.description ?? "",
        col.name,
        card.priority ?? "normal",
        card.deadline ?? "",
        (card.tags ?? []).join(", "),
        (card.assignees ?? []).join(", "),
        checklist.length ? `${checklist.filter((c) => c.done).length}/${checklist.length}` : "",
        card.createdAt ?? "",
      ]);
    }
  }
  return toCsv(rows);
}
