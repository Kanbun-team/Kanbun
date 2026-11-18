import { prisma } from "@/lib/db-local";
import { requirePageUser } from "@/auth";
import { getLocale } from "@/lib/get-locale";
import { formatDate, formatDateTime, t } from "@/lib/i18n";
import ActionForm from "@/components/ui/ActionForm";
import { buttonClass } from "@/components/ui/button";
import EmptyState from "@/components/ui/EmptyState";
import Link from "next/link";
import { Trash2 } from "lucide-react";
import { TRASH_RETENTION_DAYS, boardSnapshotOwners, trashCutoff } from "@/server/trash";
import { restoreTrashFormAction } from "@/server/trash-actions";
import { titleMetadata } from "@/server/page-title";

export const dynamic = "force-dynamic";

export function generateMetadata() {
  return titleMetadata("trashTitle");
}

const DAY_MS = 24 * 60 * 60 * 1000;

export default async function TrashPage() {
  const me = await requirePageUser();
  const locale = await getLocale();
  const isAdmin = me.role === "admin";
  const since = trashCutoff();

  const [items, memberships] = await Promise.all([
    prisma.trashItem.findMany({ where: { deletedAt: { gte: since } }, orderBy: { deletedAt: "desc" } }),
    prisma.boardMember.findMany({ where: { userId: me.id }, select: { boardId: true, role: true } }),
  ]);
  const roles = new Map(memberships.map((m) => [m.boardId, m.role]));

  // Same rules as restoreTrashAction, so every listed item can be restored.
  const visible = items.filter((item) => {
    if (isAdmin) return true;
    if (item.kind === "board") return boardSnapshotOwners(item.payload).includes(me.id);
    const role = roles.get(item.boardId);
    return item.kind === "card" ? role !== undefined : role === "owner";
  });

  const [boards, users] = await Promise.all([
    prisma.board.findMany({
      where: { id: { in: [...new Set(visible.map((i) => i.boardId))] } },
      select: { id: true, name: true },
    }),
    prisma.user.findMany({
      where: { id: { in: [...new Set(visible.map((i) => i.deletedById).filter((v): v is string => !!v))] } },
      select: { id: true, username: true, displayName: true },
    }),
  ]);
  const boardName = new Map(boards.map((b) => [b.id, b.name]));
  const userName = new Map(users.map((u) => [u.id, u.displayName ?? u.username]));
  const days = String(TRASH_RETENTION_DAYS);
  const kindLabel = { card: t("trashKindCard", locale), column: t("trashKindColumn", locale), board: t("trashKindBoard", locale) };

  return (
    <div className="space-y-6 max-w-3xl">
      <header>
        <h1 className="text-xl font-semibold">{t("trashTitle", locale)}</h1>
        <p className="mt-1 text-ink-muted">{t("trashIntro", locale).replace("{days}", days)}</p>
      </header>

      {visible.length === 0 ? (
        <EmptyState
          icon={<Trash2 size={20} />}
          title={t("trashEmptyTitle", locale)}
          action={
            <Link href="/tasks" className={buttonClass("secondary", "md")}>
              {t("trashEmptyAction", locale)}
            </Link>
          }
        >
          {t("trashEmpty", locale).replace("{days}", days)}
        </EmptyState>
      ) : (
        <ul className="bg-surface border border-line rounded-panel divide-y divide-line">
          {visible.map((item) => {
            const board = item.kind === "board" ? null : boardName.get(item.boardId);
            const by = item.deletedById ? userName.get(item.deletedById) : null;
            const expires = new Date(item.deletedAt.getTime() + TRASH_RETENTION_DAYS * DAY_MS);
            return (
              <li key={item.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <div className="font-medium truncate">
                    <span className="text-ink-muted font-normal">{kindLabel[item.kind as keyof typeof kindLabel]}: </span>
                    {item.label}
                    {board && <span className="text-ink-muted font-normal"> {t("trashOnBoard", locale).replace("{board}", board)}</span>}
                  </div>
                  <div className="text-sm text-ink-muted">
                    {[
                      by ? t("trashDeletedBy", locale).replace("{name}", by) : null,
                      formatDateTime(item.deletedAt, locale),
                    ]
                      .filter(Boolean)
                      .join(", ")}
                  </div>
                  <div className="text-xs text-ink-muted">
                    {t("trashExpires", locale).replace("{date}", formatDate(expires, locale))}
                  </div>
                </div>
                <ActionForm action={restoreTrashFormAction} success={t("restored", locale)}>
                  <input type="hidden" name="trashId" value={item.id} />
                  <button className={buttonClass("secondary", "sm")}>{t("trashRestore", locale)}</button>
                </ActionForm>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
