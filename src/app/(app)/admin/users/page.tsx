import Link from "next/link";
import { redirect } from "next/navigation";
import Avatar from "@/components/Avatar";
import { auth } from "@/auth";
import { prisma } from "@/lib/db-local";
import { getLocale } from "@/lib/get-locale";
import { t, formatDateTime } from "@/lib/i18n";
import { asAppRole, roleBadgeClass, roleFullLabel } from "@/lib/labels";
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
  const me = session.user;

  const users = await prisma.user.findMany({
    orderBy: [{ role: "asc" }, { createdAt: "asc" }],
    include: {
      sessions: {
        orderBy: { lastSeenAt: "desc" },
        take: 1,
        select: { lastSeenAt: true },
      },
    },
  });

  const adminCount = users.filter((u) => asAppRole(u.role) === "admin").length;
  const onlineCount = users.filter((u) => isOnline(u.sessions[0]?.lastSeenAt)).length;

  return (
    <div className="space-y-6">
      <header className="flex items-end justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-semibold">{t("adminUsers", locale)}</h1>
          <p className="text-sm opacity-60 mt-0.5">
            {users.length} total &middot; {adminCount} admin &middot; {onlineCount} {t("online", locale).toLowerCase()}
          </p>
        </div>
        <details className="group relative">
          <summary className="list-none cursor-pointer rounded-lg bg-brand-600 hover:bg-brand-700 text-white text-sm px-4 py-2 font-medium select-none">
            + {t("adminCreateUser", locale)}
          </summary>
          <form
            action={adminCreateUserAction}
            className="absolute right-0 mt-2 w-[min(420px,calc(100vw-2rem))] surface border rounded-xl shadow-xl p-4 z-30 space-y-3"
          >
            <h2 className="font-medium text-sm">{t("adminCreateUser", locale)}</h2>
            <label className="block">
              <span className="text-xs opacity-70">{t("authUsername", locale)}</span>
              <input name="username" required minLength={2} maxLength={32} pattern="[a-zA-Z0-9_.\-]+" autoFocus />
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
              <select name="role" defaultValue="member">
                <option value="member">{roleFullLabel("member", locale)}</option>
                <option value="admin">{roleFullLabel("admin", locale)}</option>
              </select>
            </label>
            <button className="w-full rounded-lg bg-brand-600 hover:bg-brand-700 text-white text-sm py-2 font-medium">
              {t("create", locale)}
            </button>
          </form>
        </details>
      </header>

      <ul className="surface border rounded-xl divide-y divide-[var(--border)] overflow-hidden">
        {users.map((u) => {
          const lastSeen = u.sessions[0]?.lastSeenAt ?? null;
          const online = isOnline(lastSeen);
          const role = asAppRole(u.role);
          const isMe = u.id === me.id;
          return (
            <li key={u.id}>
              <details className="group">
                <summary className="list-none cursor-pointer flex items-center gap-3 px-4 py-3 hover:bg-slate-50 dark:hover:bg-slate-800/40">
                  <Avatar src={u.avatarUrl} name={u.displayName ?? u.username} size={40} online={online} />
                  <div className="min-w-0 flex-1">
                    <div className="font-medium truncate">
                      {u.displayName ?? u.username}
                      {isMe && <span className="ml-2 text-[10px] uppercase tracking-wide opacity-50">you</span>}
                    </div>
                    <div className="text-xs opacity-60 truncate">@{u.username}</div>
                  </div>
                  <span className={`text-[10px] uppercase tracking-wide px-2 py-0.5 rounded font-semibold ${roleBadgeClass(role)}`}>
                    {roleFullLabel(role, locale)}
                  </span>
                  <div className="hidden sm:block text-xs opacity-60 w-40 text-right truncate">
                    {lastSeen
                      ? online
                        ? t("online", locale)
                        : `${t("lastSeen", locale)} ${formatDateTime(lastSeen, locale)}`
                      : t("offline", locale)}
                  </div>
                  <svg
                    width="16" height="16" viewBox="0 0 20 20" fill="none"
                    stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
                    className="opacity-50 transition-transform group-open:rotate-180"
                    aria-hidden="true"
                  >
                    <path d="M5 8l5 5 5-5" />
                  </svg>
                </summary>

                <div className="px-4 pb-4 pt-2 bg-slate-50 dark:bg-slate-900/40 space-y-4">
                  <div>
                    <Link
                      href={`/users/${encodeURIComponent(u.username)}`}
                      className="text-xs underline opacity-70 hover:opacity-100"
                    >
                      {t("navProfile", locale)} &rarr;
                    </Link>
                  </div>
                  <div className="grid gap-4 sm:grid-cols-2">
                  <form action={adminUpdateUserAction} className="space-y-2">
                    <h3 className="text-xs uppercase tracking-wide opacity-60">{t("edit", locale)}</h3>
                    <input type="hidden" name="userId" value={u.id} />
                    <label className="block">
                      <span className="text-xs opacity-70">{t("settingsDisplayName", locale)}</span>
                      <input name="displayName" defaultValue={u.displayName ?? ""} maxLength={64} />
                    </label>
                    <label className="block">
                      <span className="text-xs opacity-70">{t("adminRole", locale)}</span>
                      <select name="role" defaultValue={role} disabled={isMe}>
                        <option value="member">{roleFullLabel("member", locale)}</option>
                        <option value="admin">{roleFullLabel("admin", locale)}</option>
                      </select>
                      {isMe && (
                        <span className="text-[10px] opacity-50">You cannot change your own role.</span>
                      )}
                    </label>
                    <button className="rounded-lg bg-brand-600 hover:bg-brand-700 text-white text-sm px-3 py-1.5">
                      {t("save", locale)}
                    </button>
                  </form>

                  <div className="space-y-2">
                    <form action={adminResetPasswordAction} className="space-y-2">
                      <h3 className="text-xs uppercase tracking-wide opacity-60">
                        {t("adminResetPassword", locale)}
                      </h3>
                      <input type="hidden" name="userId" value={u.id} />
                      <label className="block">
                        <span className="text-xs opacity-70">{t("authPassword", locale)}</span>
                        <input
                          name="password"
                          type="password"
                          minLength={6}
                          required
                        />
                      </label>
                      <button className="rounded-lg border border-[var(--border)] hover:bg-white dark:hover:bg-slate-800 text-sm px-3 py-1.5">
                        {t("adminResetPassword", locale)}
                      </button>
                    </form>

                    {!isMe && (
                      <form action={adminDeleteUserAction} className="pt-3 mt-3 border-t border-[var(--border)]">
                        <h3 className="text-xs uppercase tracking-wide opacity-60 mb-2">
                          {t("delete", locale)}
                        </h3>
                        <input type="hidden" name="userId" value={u.id} />
                        <button className="rounded-lg border border-red-500/40 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 text-sm px-3 py-1.5">
                          {t("adminDeleteUser", locale)}
                        </button>
                      </form>
                    )}
                  </div>
                  </div>
                </div>
              </details>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
