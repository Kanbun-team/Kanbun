import Link from "next/link";
import { redirect } from "next/navigation";
import Avatar from "@/components/Avatar";
import { auth } from "@/auth";
import { prisma } from "@/lib/db-local";
import { getLocale } from "@/lib/get-locale";
import ActionForm from "@/components/ui/ActionForm";
import { buttonClass } from "@/components/ui/button";
import { t, formatDateTime } from "@/lib/i18n";
import { asAppRole, roleBadgeClass, roleFullLabel } from "@/lib/labels";
import { isOnline } from "@/lib/sessions";
import {
  adminCreateUserAction,
  adminDeleteUserAction,
  adminResetPasswordAction,
  adminSetUserActiveAction,
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
          <p className="text-sm text-ink-muted mt-0.5">
            {users.length} total &middot; {adminCount} admin &middot; {onlineCount} {t("online", locale).toLowerCase()}
          </p>
        </div>
        <details className="group relative">
          <summary className={buttonClass("primary", "md", "list-none cursor-pointer select-none")}>
            + {t("adminCreateUser", locale)}
          </summary>
          <ActionForm
            action={adminCreateUserAction}
            success={t("userCreatedToast", locale)}
            resetOnSuccess
            className="absolute right-0 mt-2 w-[min(420px,calc(100vw-2rem))] bg-raised border border-line rounded-panel shadow-float p-4 z-30 space-y-3"
          >
            <h2 className="font-semibold">{t("adminCreateUser", locale)}</h2>
            <label className="block">
              <span className="text-sm text-ink-muted">{t("authUsername", locale)}</span>
              <input name="username" required minLength={2} maxLength={32} pattern="[a-zA-Z0-9_.\-]+" autoFocus />
            </label>
            <label className="block">
              <span className="text-sm text-ink-muted">{t("settingsDisplayName", locale)}</span>
              <input name="displayName" maxLength={64} />
            </label>
            <label className="block">
              <span className="text-sm text-ink-muted">{t("authPassword", locale)}</span>
              <input name="password" type="password" required minLength={6} />
            </label>
            <label className="block">
              <span className="text-sm text-ink-muted">{t("adminRole", locale)}</span>
              <select name="role" defaultValue="member">
                <option value="member">{roleFullLabel("member", locale)}</option>
                <option value="admin">{roleFullLabel("admin", locale)}</option>
              </select>
            </label>
            <button className={buttonClass("primary", "md", "w-full")}>
              {t("create", locale)}
            </button>
          </ActionForm>
        </details>
      </header>

      <ul className="bg-surface border border-line rounded-panel divide-y divide-line overflow-hidden">
        {users.map((u) => {
          const lastSeen = u.sessions[0]?.lastSeenAt ?? null;
          const online = isOnline(lastSeen);
          const role = asAppRole(u.role);
          const isMe = u.id === me.id;
          const name = u.displayName ?? u.username;
          const deactivated = !!u.deactivatedAt;
          return (
            <li key={u.id}>
              <details className="group">
                <summary className="list-none cursor-pointer flex items-center gap-3 px-4 py-3 hover:bg-paper">
                  <Avatar src={u.avatarUrl} name={name} size={40} online={online && !deactivated} />
                  <div className={`min-w-0 flex-1 ${deactivated ? "text-ink-muted" : ""}`}>
                    <div className="font-medium truncate">
                      {name}
                      {isMe && <span className="ml-2 text-xs text-ink-muted">({t("youLabel", locale)})</span>}
                    </div>
                    <div className="text-xs text-ink-muted truncate">@{u.username}</div>
                  </div>
                  {deactivated && (
                    <span className="text-xs px-2 py-0.5 rounded-control border border-line-strong text-ink-muted">
                      {t("userDeactivated", locale)}
                    </span>
                  )}
                  <span className={`text-xs px-2 py-0.5 rounded-control font-medium ${roleBadgeClass(role)}`}>
                    {roleFullLabel(role, locale)}
                  </span>
                  <div className="hidden sm:block text-xs text-ink-muted w-40 text-right truncate">
                    {lastSeen
                      ? online
                        ? t("online", locale)
                        : `${t("lastSeen", locale)} ${formatDateTime(lastSeen, locale)}`
                      : t("offline", locale)}
                  </div>
                  <svg
                    width="16" height="16" viewBox="0 0 20 20" fill="none"
                    stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
                    className="text-ink-muted transition-transform group-open:rotate-180"
                    aria-hidden="true"
                  >
                    <path d="M5 8l5 5 5-5" />
                  </svg>
                </summary>

                <div className="px-4 pb-4 pt-2 bg-paper space-y-4">
                  <div>
                    <Link
                      href={`/users/${encodeURIComponent(u.username)}`}
                      className="text-sm text-accent hover:underline"
                    >
                      {t("navProfile", locale)} &rarr;
                    </Link>
                  </div>
                  <div className="grid gap-4 sm:grid-cols-2">
                  <ActionForm action={adminUpdateUserAction} success={t("savedToast", locale)} className="space-y-2">
                    <h3 className="text-sm font-semibold">{t("edit", locale)}</h3>
                    <input type="hidden" name="userId" value={u.id} />
                    <label className="block">
                      <span className="text-sm text-ink-muted">{t("settingsDisplayName", locale)}</span>
                      <input name="displayName" defaultValue={u.displayName ?? ""} maxLength={64} />
                    </label>
                    <label className="block">
                      <span className="text-sm text-ink-muted">{t("adminRole", locale)}</span>
                      <select name="role" defaultValue={role} disabled={isMe}>
                        <option value="member">{roleFullLabel("member", locale)}</option>
                        <option value="admin">{roleFullLabel("admin", locale)}</option>
                      </select>
                      {isMe && (
                        <span className="text-xs text-ink-muted">{t("ownRoleLocked", locale)}</span>
                      )}
                    </label>
                    <button className={buttonClass("primary", "sm")}>
                      {t("save", locale)}
                    </button>
                  </ActionForm>

                  <div className="space-y-2">
                    <ActionForm action={adminResetPasswordAction} success={t("passwordResetToast", locale)} resetOnSuccess className="space-y-2">
                      <h3 className="text-sm font-semibold">
                        {t("adminResetPassword", locale)}
                      </h3>
                      <input type="hidden" name="userId" value={u.id} />
                      <label className="block">
                        <span className="text-sm text-ink-muted">{t("authPassword", locale)}</span>
                        <input
                          name="password"
                          type="password"
                          minLength={6}
                          required
                        />
                      </label>
                      <button className={buttonClass("secondary", "sm")}>
                        {t("adminResetPassword", locale)}
                      </button>
                    </ActionForm>

                    {!isMe && (
                      <div className="pt-3 mt-3 border-t border-line flex flex-wrap gap-2">
                        <ActionForm
                          action={adminSetUserActiveAction}
                          success={(deactivated ? t("userReactivatedToast", locale) : t("userDeactivatedToast", locale)).replace("{name}", name)}
                          confirm={
                            deactivated
                              ? undefined
                              : {
                                  title: t("confirmDeactivateUser", locale).replace("{name}", name),
                                  body: t("confirmDeactivateUserBody", locale),
                                  confirmLabel: t("userDeactivate", locale),
                                  danger: true,
                                }
                          }
                        >
                          <input type="hidden" name="userId" value={u.id} />
                          <input type="hidden" name="active" value={deactivated ? "true" : "false"} />
                          <button className={buttonClass("secondary", "sm")}>
                            {deactivated ? t("userReactivate", locale) : t("userDeactivate", locale)}
                          </button>
                        </ActionForm>
                        <ActionForm
                          action={adminDeleteUserAction}
                          confirm={{
                            title: t("confirmDeleteUser", locale).replace("{name}", name),
                            body: t("confirmDeleteUserBody", locale),
                            confirmLabel: t("adminDeleteUser", locale),
                            danger: true,
                          }}
                        >
                          <input type="hidden" name="userId" value={u.id} />
                          <button className={buttonClass("danger", "sm")}>{t("adminDeleteUser", locale)}</button>
                        </ActionForm>
                      </div>
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
