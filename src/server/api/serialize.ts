// JSON shapes of the REST API (and of webhook payloads). Keep these in sync
// with the schemas in docs/openapi.json.

import type { Prisma } from "@prisma/client";

export const userRefSelect = { id: true, username: true, displayName: true } satisfies Prisma.UserSelect;
type UserRef = Prisma.UserGetPayload<{ select: typeof userRefSelect }>;

export function userRef(u: UserRef | null | undefined) {
  return u ? { id: u.id, username: u.username, displayName: u.displayName } : null;
}

/** Calendar date (deadlines are stored as UTC midnight) as YYYY-MM-DD. */
export function dateOnly(d: Date | null): string | null {
  return d ? d.toISOString().slice(0, 10) : null;
}

export const cardInclude = {
  column: { select: { boardId: true } },
  createdBy: { select: userRefSelect },
  assignees: { select: { user: { select: userRefSelect } } },
  tags: { select: { tag: { select: { id: true, name: true, color: true, position: true } } } },
} satisfies Prisma.TaskCardInclude;

export type CardRow = Prisma.TaskCardGetPayload<{ include: typeof cardInclude }>;

export function cardJson(c: CardRow) {
  return {
    id: c.id,
    boardId: c.column.boardId,
    columnId: c.columnId,
    title: c.title,
    description: c.description,
    position: c.position,
    priority: c.priority,
    deadline: dateOnly(c.deadline),
    coverColor: c.coverColor,
    createdBy: userRef(c.createdBy),
    assignees: c.assignees.map((a) => userRef(a.user)!),
    tags: c.tags
      .map((t) => t.tag)
      .sort((a, b) => a.position - b.position)
      .map((t) => ({ id: t.id, name: t.name, color: t.color })),
    createdAt: c.createdAt.toISOString(),
    updatedAt: c.updatedAt.toISOString(),
  };
}

export type CardJson = ReturnType<typeof cardJson>;

export function columnJson(c: { id: string; boardId: string; name: string; position: number; wipLimit: number | null }) {
  return { id: c.id, boardId: c.boardId, name: c.name, position: c.position, wipLimit: c.wipLimit };
}

export function tagJson(t: { id: string; boardId: string; name: string; color: string }) {
  return { id: t.id, boardId: t.boardId, name: t.name, color: t.color };
}

export function boardJson(b: {
  id: string;
  name: string;
  description: string | null;
  color: string;
  archived: boolean;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: b.id,
    name: b.name,
    description: b.description,
    color: b.color,
    archived: b.archived,
    createdAt: b.createdAt.toISOString(),
    updatedAt: b.updatedAt.toISOString(),
  };
}

export const commentInclude = { author: { select: userRefSelect } } satisfies Prisma.TaskCardCommentInclude;
type CommentRow = Prisma.TaskCardCommentGetPayload<{ include: typeof commentInclude }>;

export function commentJson(c: CommentRow) {
  return {
    id: c.id,
    cardId: c.cardId,
    body: c.body,
    author: userRef(c.author),
    createdAt: c.createdAt.toISOString(),
    updatedAt: c.updatedAt.toISOString(),
  };
}
