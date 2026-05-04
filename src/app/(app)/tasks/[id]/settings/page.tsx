import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { prisma } from "@/lib/db-local";
import Avatar from "@/components/Avatar";
import { getLocale } from "@/lib/get-locale";
import { t } from "@/lib/i18n";
import { boardRoleLabel } from "@/lib/labels";
import { canManageBoard, loadBoardAccess } from "@/server/board-access";
import {
  addBoardMemberAction,
  archiveBoardAction,
  createBoardTagAction,
  deleteBoardAction,
  deleteBoardTagAction,
  removeBoardMemberAction,
  updateBoardAction,
  updateBoardMemberAction,
} from "@/server/tasks-actions";

export const dynamic = "force-dynamic";

export default async function BoardSettingsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  let access;
  try {
    access = await loadBoardAccess(id);
  } catch {
    notFound();
  }
  if (!canManageBoard(access)) redirect(`/tasks/${id}`);
  const locale = await getLocale();

  const board = await prisma.board.findUnique({
    where: { id },
    include: {
      members: {
        include: { user: { select: { id: true, username: true, displayName: true, avatarUrl: true } } },
        orderBy: { addedAt: "asc" },
      },
      tags: { orderBy: { position: "asc" } },
    },
  });
  if (!board) notFound();

  return (
    <div className="space-y-6">
      <Link href={`/tasks/${id}`} className="text-sm opacity-70 hover:opacity-100">
        &larr; {board.name}
      </Link>
      <h1 className="text-xl font-semibold">{t("boardSettings", locale)}</h1>

      <form action={updateBoardAction} className="surface border rounded-xl p-4 space-y-3">
        <input type="hidden" name="boardId" value={board.id} />
        <label className="block">
          <span className="text-sm opacity-80">{t("boardName", locale)}</span>
          <input name="name" defaultValue={board.name} required maxLength={120} />
        </label>
        <label className="block">
          <span className="text-sm opacity-80">{t("boardDescription", locale)}</span>
          <textarea name="description" defaultValue={board.description ?? ""} rows={3} maxLength={2000} />
        </label>
        <button className="rounded bg-brand-600 hover:bg-brand-700 text-white px-3 py-1.5 text-sm">
          {t("save", locale)}
        </button>
      </form>

      <div className="grid sm:grid-cols-2 gap-4">
        <form action={archiveBoardAction} className="surface border rounded-xl p-4 flex items-center justify-between">
          <input type="hidden" name="boardId" value={board.id} />
          <input type="hidden" name="archived" value={String(!board.archived)} />
          <span className="text-sm">
            {board.archived ? t("boardArchived", locale) : t("boardArchive", locale)}
          </span>
          <button className="rounded px-3 py-1.5 text-sm border border-[var(--border)] hover:bg-slate-100 dark:hover:bg-slate-800">
            {board.archived ? t("boardUnarchive", locale) : t("boardArchive", locale)}
          </button>
        </form>

        <form action={deleteBoardAction} className="surface border rounded-xl p-4 flex items-center justify-between">
          <input type="hidden" name="boardId" value={board.id} />
          <span className="text-sm">{t("boardDelete", locale)}</span>
          <button className="rounded px-3 py-1.5 text-sm border border-red-500/40 text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20">
            {t("delete", locale)}
          </button>
        </form>
      </div>

      <section className="surface border rounded-xl p-4 space-y-3">
        <h2 className="text-sm uppercase tracking-wide opacity-60">{t("boardMembers", locale)}</h2>
        <ul className="divide-y divide-[var(--border)]">
          {board.members.map((m) => (
            <li key={m.userId} className="py-2 flex items-center gap-3">
              <Avatar src={m.user.avatarUrl} name={m.user.displayName ?? m.user.username} size={28} />
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium truncate">{m.user.displayName ?? m.user.username}</div>
                <div className="text-xs opacity-60 truncate">@{m.user.username}</div>
              </div>
              <span className="text-xs opacity-70 mr-2">{boardRoleLabel(m.role, locale)}</span>
              <form action={updateBoardMemberAction}>
                <input type="hidden" name="boardId" value={board.id} />
                <input type="hidden" name="userId" value={m.userId} />
                <input type="hidden" name="role" value={m.role === "owner" ? "member" : "owner"} />
                <button className="text-xs px-2 py-1 rounded border border-[var(--border)] hover:bg-slate-100 dark:hover:bg-slate-800">
                  {m.role === "owner" ? t("boardMakeMember", locale) : t("boardMakeOwner", locale)}
                </button>
              </form>
              <form action={removeBoardMemberAction}>
                <input type="hidden" name="boardId" value={board.id} />
                <input type="hidden" name="userId" value={m.userId} />
                <button className="text-xs ml-2 text-red-500 hover:underline">
                  {t("boardRemoveMember", locale)}
                </button>
              </form>
            </li>
          ))}
        </ul>
        <form action={addBoardMemberAction} className="flex gap-2 pt-2">
          <input type="hidden" name="boardId" value={board.id} />
          <input name="username" required placeholder="username" />
          <button className="rounded bg-brand-600 hover:bg-brand-700 text-white px-3 text-sm">
            {t("boardAddMember", locale)}
          </button>
        </form>
      </section>

      <section className="surface border rounded-xl p-4 space-y-3">
        <h2 className="text-sm uppercase tracking-wide opacity-60">{t("boardTags", locale)}</h2>
        <ul className="space-y-1">
          {board.tags.map((tag) => (
            <li key={tag.id} className="flex items-center gap-2">
              <span className="w-3 h-3 rounded-full" style={{ background: tag.color }} />
              <span className="text-sm flex-1">{tag.name}</span>
              <span className="text-xs opacity-60">{tag.color}</span>
              <form action={deleteBoardTagAction}>
                <input type="hidden" name="tagId" value={tag.id} />
                <button className="text-xs text-red-500 hover:underline ml-2">{t("delete", locale)}</button>
              </form>
            </li>
          ))}
          {board.tags.length === 0 && <li className="text-sm opacity-60">{t("none", locale)}</li>}
        </ul>
        <form action={createBoardTagAction} className="flex flex-wrap gap-2 items-end">
          <input type="hidden" name="boardId" value={board.id} />
          <label className="flex-1 min-w-[160px]">
            <span className="text-xs opacity-70">{t("cardTags", locale)}</span>
            <input name="name" required maxLength={40} placeholder="bug" />
          </label>
          <label>
            <span className="text-xs opacity-70">color</span>
            <input
              name="color"
              required
              defaultValue="#2563eb"
              pattern="#?[0-9a-fA-F]{6}"
              className="w-32"
            />
          </label>
          <button className="rounded bg-brand-600 hover:bg-brand-700 text-white text-sm px-3 py-1.5">
            {t("add", locale)}
          </button>
        </form>
      </section>
    </div>
  );
}
