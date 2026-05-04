import { prisma } from "@/lib/db-local";
import { auth } from "@/auth";

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
  if (!user?.id) throw new Error("Unauthorized");
  if (!user.accessTasks && user.role !== "admin") throw new Error("Forbidden");

  const board = await prisma.board.findUnique({
    where: { id: boardId },
    select: { id: true },
  });
  if (!board) throw new Error("Board not found");

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
  if (!member) throw new Error("Forbidden");

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
