// Document titles for the App Router `generateMetadata` exports. The root
// layout adds " · Kanbun" (title.template), so these return only the page
// part, in the reader's language. Board and card names are only revealed to
// people who can open the board; everyone else gets the plain app title.

import { cache } from "react";
import type { Metadata } from "next";
import { auth } from "@/auth";
import { prisma } from "@/lib/db-local";
import { getLocale } from "@/lib/get-locale";
import { t, type DictKey } from "@/lib/i18n";

export async function titleMetadata(key: DictKey): Promise<Metadata> {
  return { title: t(key, await getLocale()) };
}

const visibleBoard = cache(async (boardId: string): Promise<{ name: string } | null> => {
  const session = await auth();
  const user = session?.user;
  if (!user?.id) return null;
  return prisma.board.findFirst({
    where: { id: boardId, ...(user.role === "admin" ? {} : { members: { some: { userId: user.id } } }) },
    select: { name: true },
  });
});

/** "<board>" for the board page. */
export async function boardTitle(boardId: string): Promise<Metadata> {
  const board = await visibleBoard(boardId);
  return board ? { title: board.name } : {};
}

/** "<page> · <board>", e.g. "Settings · Website relaunch". */
export async function boardPageTitle(boardId: string, key: DictKey): Promise<Metadata> {
  const [board, locale] = await Promise.all([visibleBoard(boardId), getLocale()]);
  return board ? { title: `${t(key, locale)} · ${board.name}` } : { title: t(key, locale) };
}

/** "<card> · <board>" for the card page and the card panel. */
export async function cardTitle(boardId: string, cardId: string): Promise<Metadata> {
  const board = await visibleBoard(boardId);
  if (!board) return {};
  const card = await prisma.taskCard.findFirst({
    where: { id: cardId, column: { boardId } },
    select: { title: true },
  });
  return { title: card ? `${card.title} · ${board.name}` : board.name };
}
