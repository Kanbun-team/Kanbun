"use client";

// Sends one outbox operation through the same server actions the board uses
// online. Throws on network errors (the caller keeps the entry for later).

import {
  addCardAction,
  moveCardAction,
  toggleAssigneeAction,
  toggleCardTagAction,
  updateCardAction,
} from "@/server/tasks-actions";
import type { OutboxOp, RunResult } from "@/lib/outbox";

function form(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}

export async function runOutboxOp(op: OutboxOp): Promise<RunResult> {
  switch (op.kind) {
    case "move": {
      const r = await moveCardAction({ cardId: op.cardId, toColumnId: op.toColumnId, position: op.position });
      return r.ok ? { ok: true } : r;
    }
    case "update": {
      const fields: Record<string, string> = { cardId: op.cardId };
      const f = op.fields;
      if (f.title !== undefined) fields.title = f.title;
      if (f.priority !== undefined) fields.priority = f.priority;
      if (f.deadline !== undefined) fields.deadline = f.deadline ?? "";
      if (f.coverColor !== undefined) fields.coverColor = f.coverColor ?? "";
      const r = await updateCardAction(form(fields));
      return r.ok ? { ok: true } : r;
    }
    case "assignee": {
      const r = await toggleAssigneeAction(form({ cardId: op.cardId, userId: op.user.id, on: op.on ? "1" : "0" }));
      return r.ok ? { ok: true } : r;
    }
    case "tag": {
      const r = await toggleCardTagAction(form({ cardId: op.cardId, tagId: op.tag.id, on: op.on ? "1" : "0" }));
      return r.ok ? { ok: true } : r;
    }
    case "addCards": {
      const r = await addCardAction(form({ columnId: op.columnId, title: op.titles.join("\n") }));
      return r.ok ? { ok: true, createdIds: r.data.ids } : r;
    }
  }
}

/** Signed out: keep the queued edits until the user signs in again. */
export const retryableError = (error: string) => error === "unauthorized";
