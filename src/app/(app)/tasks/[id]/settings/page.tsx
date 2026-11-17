import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { prisma } from "@/lib/db-local";
import Avatar from "@/components/Avatar";
import ColorPicker from "@/components/ColorPicker";
import { getLocale } from "@/lib/get-locale";
import ActionForm from "@/components/ui/ActionForm";
import { buttonClass } from "@/components/ui/button";
import TagChip from "@/components/ui/TagChip";
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
        include: {
          user: { select: { id: true, username: true, displayName: true, avatarUrl: true, deactivatedAt: true } },
        },
        orderBy: { addedAt: "asc" },
      },
      tags: { orderBy: { position: "asc" } },
    },
  });
  if (!board) notFound();

  const card = "bg-surface border border-line rounded-panel p-4";
  const label = "text-sm text-ink-muted";

  return (
    <div className="space-y-6 max-w-3xl">
      <Link href={`/tasks/${id}`} className="text-sm text-ink-muted hover:text-ink">
        &larr; {board.name}
      </Link>
      <h1 className="text-xl font-semibold">{t("boardSettings", locale)}</h1>

      <ActionForm action={updateBoardAction} success={t("savedToast", locale)} className={`${card} space-y-3`}>
        <input type="hidden" name="boardId" value={board.id} />
        <label className="block space-y-1">
          <span className={label}>{t("boardName", locale)}</span>
          <input name="name" defaultValue={board.name} required maxLength={120} />
        </label>
        <label className="block space-y-1">
          <span className={label}>{t("boardDescription", locale)}</span>
          <textarea name="description" defaultValue={board.description ?? ""} rows={3} maxLength={2000} />
        </label>
        <div>
          <span className={`${label} block mb-1.5`}>{t("boardColor", locale)}</span>
          <ColorPicker name="color" defaultValue={board.color} />
        </div>
        <button className={buttonClass("primary")}>{t("save", locale)}</button>
      </ActionForm>

      <div className="grid sm:grid-cols-2 gap-4">
        <ActionForm action={archiveBoardAction} className={`${card} flex items-center justify-between gap-3`}>
          <input type="hidden" name="boardId" value={board.id} />
          <input type="hidden" name="archived" value={String(!board.archived)} />
          <span>{board.archived ? t("boardArchived", locale) : t("boardArchive", locale)}</span>
          <button className={buttonClass("secondary")}>
            {board.archived ? t("boardUnarchive", locale) : t("boardArchive", locale)}
          </button>
        </ActionForm>

        <ActionForm
          action={deleteBoardAction}
          undo
          success={t("boardDeleted", locale)}
          redirectTo="/tasks"
          className={`${card} flex items-center justify-between gap-3`}
        >
          <input type="hidden" name="boardId" value={board.id} />
          <span>{t("boardDelete", locale)}</span>
          <button className={buttonClass("danger")}>{t("delete", locale)}</button>
        </ActionForm>
      </div>

      <section className={`${card} space-y-3`}>
        <h2 className="text-md font-semibold">{t("boardMembers", locale)}</h2>
        <ul className="divide-y divide-line">
          {board.members.map((m) => {
            const name = m.user.displayName ?? m.user.username;
            return (
              <li key={m.userId} className="py-2 flex flex-wrap items-center gap-3">
                <Avatar src={m.user.avatarUrl} name={name} size={28} />
                <div className="flex-1 min-w-0">
                  <div className="font-medium truncate">{name}</div>
                  <div className="text-xs text-ink-muted truncate">
                    @{m.user.username}
                    {m.user.deactivatedAt && `, ${t("userDeactivated", locale).toLowerCase()}`}
                  </div>
                </div>
                <span className="text-sm text-ink-muted">{boardRoleLabel(m.role, locale)}</span>
                <ActionForm action={updateBoardMemberAction}>
                  <input type="hidden" name="boardId" value={board.id} />
                  <input type="hidden" name="userId" value={m.userId} />
                  <input type="hidden" name="role" value={m.role === "owner" ? "member" : "owner"} />
                  <button className={buttonClass("secondary", "sm")}>
                    {m.role === "owner" ? t("boardMakeMember", locale) : t("boardMakeOwner", locale)}
                  </button>
                </ActionForm>
                <ActionForm
                  action={removeBoardMemberAction}
                  confirm={{
                    title: t("confirmRemoveMember", locale).replace("{name}", name),
                    body: t("confirmRemoveMemberBody", locale),
                    confirmLabel: t("boardRemoveMember", locale),
                    danger: true,
                  }}
                >
                  <input type="hidden" name="boardId" value={board.id} />
                  <input type="hidden" name="userId" value={m.userId} />
                  <button className={buttonClass("ghost", "sm", "text-danger hover:text-danger")}>
                    {t("boardRemoveMember", locale)}
                  </button>
                </ActionForm>
              </li>
            );
          })}
        </ul>
        <ActionForm action={addBoardMemberAction} resetOnSuccess className="flex gap-2 pt-2">
          <input type="hidden" name="boardId" value={board.id} />
          <input
            name="username"
            required
            placeholder={t("authUsername", locale)}
            aria-label={t("authUsername", locale)}
          />
          <button className={buttonClass("primary", "md", "h-auto")}>{t("boardAddMember", locale)}</button>
        </ActionForm>
      </section>

      <section className={`${card} space-y-3`}>
        <h2 className="text-md font-semibold">{t("boardTags", locale)}</h2>
        <ul className="space-y-1">
          {board.tags.map((tag) => (
            <li key={tag.id} className="flex items-center gap-2">
              <TagChip name={tag.name} color={tag.color} />
              <span className="flex-1" />
              <ActionForm
                action={deleteBoardTagAction}
                confirm={{
                  title: t("confirmDeleteTag", locale).replace("{name}", tag.name),
                  body: t("confirmDeleteTagBody", locale),
                  confirmLabel: t("delete", locale),
                  danger: true,
                }}
              >
                <input type="hidden" name="tagId" value={tag.id} />
                <button className={buttonClass("ghost", "sm", "text-danger hover:text-danger")}>
                  {t("delete", locale)}
                </button>
              </ActionForm>
            </li>
          ))}
          {board.tags.length === 0 && <li className="text-ink-muted">{t("none", locale)}</li>}
        </ul>
        <ActionForm action={createBoardTagAction} resetOnSuccess className="space-y-3 pt-2">
          <input type="hidden" name="boardId" value={board.id} />
          <label className="block space-y-1">
            <span className={label}>{t("tagName", locale)}</span>
            <input name="name" required maxLength={40} />
          </label>
          <div>
            <span className={`${label} block mb-1.5`}>{t("boardColor", locale)}</span>
            <ColorPicker name="color" />
          </div>
          <button className={buttonClass("primary")}>{t("add", locale)}</button>
        </ActionForm>
      </section>
    </div>
  );
}
