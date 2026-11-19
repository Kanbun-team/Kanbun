import type { Prisma } from "@prisma/client";
import { isKnownRequestError, prisma } from "@/lib/db-local";
import { commentInclude } from "@/server/api/serialize";
import { watchCard } from "@/server/watchers";

// Creating a comment, once. The client sends a key it chose for the comment
// (the comment form makes one per draft, the offline outbox stores one with
// the queued comment, API clients send an Idempotency-Key header). When the
// connection drops after the server saved the comment, the retried send
// carries the same key and gets the saved comment back instead of a second
// one. Keys are unique per card.

/** A key as clients send it: a UUID or similar, no spaces, at most 100 characters. */
const KEY_PATTERN = /^[A-Za-z0-9_.:-]{1,100}$/;

/** The key if it is usable, null when missing or empty; throws on a malformed one. */
export function parseClientKey(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const key = String(value).trim();
  if (!key) return null;
  if (!KEY_PATTERN.test(key)) throw new CommentKeyError("malformed");
  return key;
}

export class CommentKeyError extends Error {
  /** malformed: not a valid key. taken: the key belongs to someone else's comment on this card. */
  constructor(public readonly reason: "malformed" | "taken") {
    super(`comment key ${reason}`);
    this.name = "CommentKeyError";
  }
}

type CommentRow = Prisma.TaskCardCommentGetPayload<{ include: typeof commentInclude }>;

export interface CreateCommentInput {
  cardId: string;
  authorId: string;
  body: string;
  clientKey: string | null;
}

/**
 * Creates the comment (and makes the author a card watcher), or returns the
 * comment created earlier with the same key. `created` is false for a repeat,
 * so the caller skips notifications, webhooks and other side effects.
 */
export async function createCommentOnce(input: CreateCommentInput): Promise<{ comment: CommentRow; created: boolean }> {
  const { cardId, authorId, body, clientKey } = input;

  async function existing(): Promise<CommentRow | null> {
    if (!clientKey) return null;
    const row = await prisma.taskCardComment.findUnique({
      where: { cardId_clientKey: { cardId, clientKey } },
      include: commentInclude,
    });
    if (row && row.authorId !== authorId) throw new CommentKeyError("taken");
    return row;
  }

  const earlier = await existing();
  if (earlier) return { comment: earlier, created: false };
  try {
    const comment = await prisma.$transaction(async (tx) => {
      const created = await tx.taskCardComment.create({
        data: { cardId, authorId, body, clientKey },
        include: commentInclude,
      });
      await watchCard(cardId, authorId, tx);
      return created;
    });
    return { comment, created: true };
  } catch (err) {
    // Two sends with the same key at the same time: the second one loses the
    // race on the unique index and returns the first one's comment.
    if (clientKey && isKnownRequestError(err) && err.code === "P2002") {
      const row = await existing();
      if (row) return { comment: row, created: false };
    }
    throw err;
  }
}
