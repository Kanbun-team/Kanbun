// Card details kept on the device for offline reading (see docs/OFFLINE.md).
//
// Pure logic only, unit tested in src/lib/__tests__/offline-card.test.ts:
// - `toOfflineCard` maps a card as the database returns it to the compact
//   form stored in IndexedDB. With `LITE_LIMITS` it is the lightweight form
//   that GET /api/boards/[id]/offline sends for every card of a board.
// - `applyCardOutbox` shows queued edits on top of stored details.

import type { MemberOption, TagOption } from "@/components/board/types";
import type { IdMap, OutboxEntry } from "./outbox";

export interface OfflinePerson {
  id: string;
  username: string;
  displayName: string | null;
  avatarUrl: string | null;
}

export interface OfflineChecklistItem {
  id: string;
  title: string;
  done: boolean;
  /** YYYY-MM-DD */
  dueDate: string | null;
  assigneeName: string | null;
}

export interface OfflineComment {
  id: string;
  body: string;
  createdAt: string;
  author: OfflinePerson | null;
}

export interface OfflineActivity {
  id: string;
  type: string;
  data: Record<string, unknown>;
  createdAt: string;
  actor: { username: string; displayName: string | null } | null;
}

export interface OfflineAttachment {
  id: string;
  fileName: string;
  mimeType: string;
  size: number;
  createdAt: string;
  uploaderName: string | null;
}

export interface OfflineCard {
  id: string;
  boardId: string;
  columnName: string;
  title: string;
  description: string;
  /** The description was cut to the lightweight limit. */
  descriptionTruncated: boolean;
  priority: string;
  coverColor: string | null;
  deadline: string | null;
  assignees: MemberOption[];
  tagIds: string[];
  checklist: OfflineChecklistItem[];
  /** Oldest first; with the lightweight limits only the newest few. */
  comments: OfflineComment[];
  commentsTotal: number;
  /** Empty in the lightweight form. */
  activity: OfflineActivity[];
  attachments: OfflineAttachment[];
  blocking: { cardId: string; title: string }[];
  blockedBy: { cardId: string; title: string }[];
}

/** A stored card: its details plus what is needed to edit it offline. */
export interface StoredCard {
  card: OfflineCard;
  members: MemberOption[];
  tags: TagOption[];
  /** When the server rendered this data (ISO). */
  renderedAt: string;
  /** Lightweight copy (no history, latest comments only). */
  partial: boolean;
}

/** What GET /api/boards/[id]/offline returns. */
export interface OfflineBoardCards {
  boardId: string;
  renderedAt: string;
  members: MemberOption[];
  tags: TagOption[];
  cards: OfflineCard[];
}

export interface OfflineLimits {
  descriptionChars: number;
  comments: number;
  commentChars: number;
  activity: number;
  checklist: number;
  attachments: number;
}

/** A card opened by the user: everything the card view shows. */
export const FULL_LIMITS: OfflineLimits = {
  descriptionChars: 50_000,
  comments: 200,
  commentChars: 5000,
  activity: 300,
  checklist: 500,
  attachments: 200,
};

/**
 * Every card of a board, fetched in the background: enough to read a card
 * offline, small enough for a 500-card board (see docs/OFFLINE.md).
 */
export const LITE_LIMITS: OfflineLimits = {
  descriptionChars: 2000,
  comments: 3,
  commentChars: 500,
  activity: 0,
  checklist: 50,
  attachments: 20,
};

/** Most cards the board route sends. */
export const LITE_MAX_CARDS = 1000;

type Dateish = Date | string;

const iso = (d: Dateish) => (typeof d === "string" ? d : d.toISOString());

function person(u: OfflinePerson): OfflinePerson {
  return { id: u.id, username: u.username, displayName: u.displayName, avatarUrl: u.avatarUrl };
}

function cut(text: string, max: number): { text: string; cut: boolean } {
  return text.length > max ? { text: `${text.slice(0, max).trimEnd()}...`, cut: true } : { text, cut: false };
}

/** A card with its relations, as Prisma returns it (only the fields used). */
export interface OfflineCardRow {
  id: string;
  title: string;
  description: string | null;
  priority: string;
  coverColor: string | null;
  deadline: Dateish | null;
  column: { name: string; boardId: string };
  assignees: { user: OfflinePerson }[];
  tags: { tagId: string }[];
  subtasks: {
    id: string;
    title: string;
    done: boolean;
    dueDate: Dateish | null;
    assignee: { username: string; displayName: string | null } | null;
  }[];
  /** Oldest first. */
  comments: { id: string; body: string; createdAt: Dateish; author: OfflinePerson | null }[];
  /** Total comment count, when `comments` holds only some. */
  commentsTotal?: number;
  attachments: {
    id: string;
    fileName: string;
    mimeType: string;
    size: number;
    createdAt: Dateish;
    uploader: { username: string; displayName: string | null } | null;
  }[];
  blocking: { blocked: { id: string; title: string } }[];
  blockedBy: { blocker: { id: string; title: string } }[];
}

export function toOfflineCard(
  row: OfflineCardRow,
  limits: OfflineLimits = FULL_LIMITS,
  /** Oldest first, already parsed. */
  activity: OfflineActivity[] = []
): OfflineCard {
  const description = cut(row.description ?? "", limits.descriptionChars);
  const comments = limits.comments > 0 ? row.comments.slice(-limits.comments) : [];
  return {
    id: row.id,
    boardId: row.column.boardId,
    columnName: row.column.name,
    title: row.title,
    description: description.text,
    descriptionTruncated: description.cut,
    priority: row.priority,
    coverColor: row.coverColor,
    deadline: row.deadline ? iso(row.deadline) : null,
    assignees: row.assignees.map((a) => person(a.user)),
    tagIds: row.tags.map((tg) => tg.tagId),
    checklist: row.subtasks.slice(0, limits.checklist).map((s) => ({
      id: s.id,
      title: s.title,
      done: s.done,
      dueDate: s.dueDate ? iso(s.dueDate).slice(0, 10) : null,
      assigneeName: s.assignee ? s.assignee.displayName ?? s.assignee.username : null,
    })),
    comments: comments.map((c) => ({
      id: c.id,
      body: cut(c.body, limits.commentChars).text,
      createdAt: iso(c.createdAt),
      author: c.author ? person(c.author) : null,
    })),
    commentsTotal: row.commentsTotal ?? row.comments.length,
    activity: limits.activity > 0 ? activity.slice(-limits.activity) : [],
    attachments: row.attachments.slice(0, limits.attachments).map((a) => ({
      id: a.id,
      fileName: a.fileName,
      mimeType: a.mimeType,
      size: a.size,
      createdAt: iso(a.createdAt),
      uploaderName: a.uploader ? a.uploader.displayName ?? a.uploader.username : null,
    })),
    blocking: row.blocking.map((b) => ({ cardId: b.blocked.id, title: b.blocked.title })),
    blockedBy: row.blockedBy.map((b) => ({ cardId: b.blocker.id, title: b.blocker.title })),
  };
}

/** The newer of two stored copies; on a tie the complete one. */
export function newerCard(a: StoredCard | undefined, b: StoredCard | undefined): StoredCard | undefined {
  if (!a) return b;
  if (!b) return a;
  if (a.renderedAt !== b.renderedAt) return a.renderedAt > b.renderedAt ? a : b;
  return a.partial && !b.partial ? b : a;
}

export interface PendingComment {
  /** The entry's temporary comment id. */
  id: string;
  body: string;
  createdAt: string;
}

export interface CardView {
  card: OfflineCard;
  /** Comments queued offline, not on the server yet. */
  pendingComments: PendingComment[];
}

/**
 * Stored card details with queued edits applied, for display. Comments that
 * were queued show as pending until they are sent; once fresh data arrives
 * they are part of the stored comments.
 */
export function applyCardOutbox(
  card: OfflineCard,
  entries: OutboxEntry[],
  idMap: IdMap = {}
): CardView {
  let next = card;
  const pendingComments: PendingComment[] = [];
  for (const entry of entries) {
    const op = entry.op;
    if (op.kind === "addCards" || op.kind === "move") continue;
    if ((idMap[op.cardId] ?? op.cardId) !== card.id) continue;
    switch (op.kind) {
      case "update":
        next = { ...next, ...op.fields } as OfflineCard;
        break;
      case "assignee": {
        const has = next.assignees.some((a) => a.id === op.user.id);
        if (has !== op.on) {
          next = {
            ...next,
            assignees: op.on ? [...next.assignees, op.user] : next.assignees.filter((a) => a.id !== op.user.id),
          };
        }
        break;
      }
      case "tag": {
        const has = next.tagIds.includes(op.tag.id);
        if (has !== op.on) {
          next = { ...next, tagIds: op.on ? [...next.tagIds, op.tag.id] : next.tagIds.filter((id) => id !== op.tag.id) };
        }
        break;
      }
      case "subtask":
        next = {
          ...next,
          checklist: next.checklist.map((item) => (item.id === op.subtaskId ? { ...item, done: op.done } : item)),
        };
        break;
      case "comment":
        pendingComments.push({ id: op.tempId, body: op.body, createdAt: new Date(entry.createdAt).toISOString() });
        break;
    }
  }
  return { card: next, pendingComments };
}
