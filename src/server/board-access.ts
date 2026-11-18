import { prisma } from "@/lib/db-local";
import { auth } from "@/auth";
import { ActionError } from "@/lib/action-result";

export type BoardAccess = {
  userId: string;
  role: string;
  isAdmin: boolean;
  boardId: string;
  boardRole: "owner" | "member" | "admin";
};

export async function loadBoardAccess(boardId: string): Promise<BoardAccess> {
  const session = await auth();
  const user = session?.user;
  if (!user?.id) throw new ActionError("unauthorized");
  return resolveBoardAccess({ id: user.id, role: user.role }, boardId);
}

/** Board access for a known user (a session user or an API token's owner). */
export async function resolveBoardAccess(user: { id: string; role: string }, boardId: string): Promise<BoardAccess> {
  const board = await prisma.board.findUnique({
    where: { id: boardId },
    select: { id: true },
  });
  if (!board) throw new ActionError("notFound");

  if (user.role === "admin") {
    return {
      userId: user.id,
      role: user.role,
      isAdmin: true,
      boardId,
      boardRole: "admin",
    };
  }

  const member = await prisma.boardMember.findUnique({
    where: { boardId_userId: { boardId, userId: user.id } },
    select: { role: true },
  });
  if (!member) throw new ActionError("forbidden");

  return {
    userId: user.id,
    role: user.role,
    isAdmin: false,
    boardId,
    boardRole: member.role === "owner" ? "owner" : "member",
  };
}

export function canManageBoard(access: BoardAccess): boolean {
  return access.isAdmin || access.boardRole === "owner";
}
