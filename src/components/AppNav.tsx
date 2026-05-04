import Link from "next/link";
import Logo from "./Logo";
import UserMenu from "./UserMenu";
import MobileNav from "./MobileNav";
import { auth } from "@/auth";
import { prisma } from "@/lib/db-local";
import { t, type Locale } from "@/lib/i18n";
import { can } from "@/lib/permissions";

export default async function AppNav({ locale }: { locale: Locale }) {
  const session = await auth();
  const user = session?.user;
  if (!user) return null;

  const boards = user.accessTasks
    ? await prisma.board.findMany({
        where: {
          archived: false,
          OR: [
            { members: { some: { userId: user.id } } },
            ...(user.role === "admin" ? [{}] : []),
          ],
        },
        select: { id: true, name: true },
        orderBy: { name: "asc" },
        take: 50,
      })
    : [];

  const isAdmin = can.isAdmin(user.role);

  return (
    <header className="border-b border-[var(--border)] surface sticky top-0 z-40">
      <div className="mx-auto max-w-7xl px-4 sm:px-6">
        <div className="flex items-center gap-3 h-14">
          <Link href="/tasks" className="flex items-center gap-2 font-semibold">
            <Logo size={26} />
            <span className="hidden sm:inline">{t("appName", locale)}</span>
          </Link>
          <nav className="hidden md:flex items-center gap-1 ml-4 text-sm">
            <Link
              href="/tasks"
              className="px-3 py-1.5 rounded-md hover:bg-slate-100 dark:hover:bg-slate-800"
            >
              {t("navBoards", locale)}
            </Link>
            <Link
              href="/tasks/me"
              className="px-3 py-1.5 rounded-md hover:bg-slate-100 dark:hover:bg-slate-800"
            >
              {t("navMyTasks", locale)}
            </Link>
            {isAdmin && (
              <Link
                href="/admin/users"
                className="px-3 py-1.5 rounded-md hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                {t("navAdmin", locale)}
              </Link>
            )}
            {boards.length > 0 && (
              <BoardSwitcher boards={boards} locale={locale} />
            )}
          </nav>
          <div className="ml-auto flex items-center gap-2">
            <UserMenu
              user={{
                username: user.username,
                displayName: user.displayName,
                avatarUrl: user.avatarUrl,
                role: user.role,
              }}
              locale={locale}
            />
            <MobileNav
              boards={boards}
              isAdmin={isAdmin}
              locale={locale}
            />
          </div>
        </div>
      </div>
    </header>
  );
}

function BoardSwitcher({
  boards,
  locale,
}: {
  boards: { id: string; name: string }[];
  locale: Locale;
}) {
  return (
    <details className="relative ml-2 group">
      <summary className="list-none cursor-pointer px-3 py-1.5 rounded-md hover:bg-slate-100 dark:hover:bg-slate-800">
        {t("boardsTitle", locale)}
      </summary>
      <div className="absolute mt-2 w-64 rounded-xl surface border shadow-lg z-50 max-h-80 overflow-auto">
        {boards.map((b) => (
          <Link
            key={b.id}
            href={`/tasks/${b.id}`}
            className="block px-4 py-2 text-sm hover:bg-slate-100 dark:hover:bg-slate-800 truncate"
          >
            {b.name}
          </Link>
        ))}
      </div>
    </details>
  );
}
