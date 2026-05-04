import Link from "next/link";
import { redirect } from "next/navigation";
import Avatar from "@/components/Avatar";
import { auth } from "@/auth";
import { prisma } from "@/lib/db-local";
import { getLocale } from "@/lib/get-locale";
import { t, formatDateTime } from "@/lib/i18n";
import { roleFullLabel } from "@/lib/labels";
import { isOnline } from "@/lib/sessions";
import {
  adminCreateUserAction,
  adminDeleteUserAction,
  adminResetPasswordAction,
  adminUpdateUserAction,
} from "@/server/actions";

export const dynamic = "force-dynamic";

export default async function AdminUsersPage() {
  const session = await auth();
  if (!session?.user?.id || session.user.role !== "admin") redirect("/tasks");
  const locale = await getLocale();

  const users = await prisma.user.findMany({
    orderBy: { createdAt: "asc" },
    include: {
      sessions: {
        orderBy: { lastSeenAt: "desc" },
        take: 1,
        select: { lastSeenAt: true },
      },
    },
  });

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold">{t("adminUsers", locale)}</h1>

      <form action={adminCreateUserAction} className="surface border rounded-xl p-4 grid sm:grid-cols-2 lg:grid-cols-5 gap-2 items-end">
        <label className="block">
          <span className="text-xs opacity-70">{t("authUsername", locale)}</span>
          <input name="username" required maxLength={32} pattern="[a-zA-Z0-9_.\-]+" />
        </label>
        <label className="block">
          <span className="text-xs opacity-70">{t("settingsDisplayName", locale)}</span>
          <input name="displayName" maxLength={64} />
        </label>
        <label className="block">
          <span className="text-xs opacity-70">{t("authPassword", locale)}</span>
          <input name="password" type="password" required minLength={6} />
        </label>
        <label className="block">
          <span className="text-xs opacity-70">{t("adminRole", locale)}</span>
          <select name="role" defaultValue="support">
            <option value="support">support</option>
            <option value="dev">dev</option>
            <option value="mod">mod</option>
            <option value="admin">admin</option>
          </select>
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="accessTasks" defaultChecked />
          {t("adminAccessTasks", locale)}
        </label>
        <button className="rounded bg-brand-600 hover:bg-brand-700 text-white text-sm px-3 py-1.5 lg:col-span-5">
          {t("adminCreateUser", locale)}
        </button>
      </form>

      <div className="surface border rounded-xl overflow-hidden">
        <ul className="divide-y divide-[var(--border)]">
          {users.map((u) => {
            const online = isOnline(u.sessions[0]?.lastSeenAt);
            return (
              <li key={u.id} className="p-3 flex flex-col sm:flex-row sm:items-center gap-3">
                <div className="flex items-center gap-3 min-w-0">
                  <Avatar src={u.avatarUrl} name={u.displayName ?? u.username} size={36} online={online} />
                  <div className="min-w-0">
                    <Link
                      href={`/users/${encodeURIComponent(u.username)}`}
                      className="font-medium hover:underline truncate block"
                    >
                      {u.displayName ?? u.username}
                    </Link>
                    <div className="text-xs opacity-60 truncate">@{u.username}</div>
                    <div className="text-[10px] opacity-50">
                      {u.sessions[0]
                        ? `${t("lastSeen", locale)}: ${formatDateTime(u.sessions[0].lastSeenAt, locale)}`
                        : t("offline", locale)}
                    </div>
                  </div>
                </div>
                <form
                  action={adminUpdateUserAction}
                  className="flex flex-wrap items-center gap-2 sm:ml-auto"
                >
                  <input type="hidden" name="userId" value={u.id} />
                  <input
                    name="displayName"
                    defaultValue={u.displayName ?? ""}
                    placeholder={t("settingsDisplayName", locale)}
                    className="!py-1 w-40"
                    maxLength={64}
                  />
                  <select name="role" defaultValue={u.role} className="!py-1">
                    <option value="support">{roleFullLabel("support", locale)}</option>
                    <option value="dev">{roleFullLabel("dev", locale)}</option>
                    <option value="mod">{roleFullLabel("mod", locale)}</option>
                    <option value="admin">{roleFullLabel("admin", locale)}</option>
                  </select>
                  <label className="flex items-center gap-1 text-xs">
                    <input type="checkbox" name="accessTasks" defaultChecked={u.accessTasks} />
                    {t("adminAccessTasks", locale)}
                  </label>
                  <button className="rounded bg-brand-600 hover:bg-brand-700 text-white text-xs px-2 py-1">
                    {t("save", locale)}
                  </button>
                </form>
                <form action={adminResetPasswordAction} className="flex items-center gap-2">
                  <input type="hidden" name="userId" value={u.id} />
                  <input name="password" type="password" minLength={6} placeholder="..." className="!py-1 w-32" />
                  <button className="rounded border border-[var(--border)] text-xs px-2 py-1">
                    {t("adminResetPassword", locale)}
                  </button>
                </form>
                <form action={adminDeleteUserAction}>
                  <input type="hidden" name="userId" value={u.id} />
                  <button className="text-xs text-red-500 hover:underline">
                    {t("adminDeleteUser", locale)}
                  </button>
                </form>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
