import Link from "next/link";
import { redirect } from "next/navigation";
import { Download } from "lucide-react";
import { requirePageUser } from "@/auth";
import { prisma } from "@/lib/db-local";
import { getLocale } from "@/lib/get-locale";
import { t } from "@/lib/i18n";
import { auditActionLabel, auditTargetLabel } from "@/lib/audit-labels";
import { buttonClass } from "@/components/ui/button";
import RelativeTime from "@/components/ui/RelativeTime";
import { AUDIT_PAGE_SIZE, auditDetails, auditFilterOptions, auditWhere, parseAuditFilters } from "@/server/audit-query";
import { auditRetentionDays } from "@/server/jobs/audit-purge";

export const dynamic = "force-dynamic";

function detailValue(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  return JSON.stringify(value);
}

export default async function AdminAuditPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requirePageUser();
  if (user.role !== "admin") redirect("/tasks");
  const locale = await getLocale();
  const filters = parseAuditFilters(await searchParams);
  const where = auditWhere(filters);

  const [total, options] = await Promise.all([prisma.auditLog.count({ where }), auditFilterOptions()]);
  const pages = Math.max(1, Math.ceil(total / AUDIT_PAGE_SIZE));
  const page = Math.min(filters.page, pages);
  const entries = await prisma.auditLog.findMany({
    where,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    skip: (page - 1) * AUDIT_PAGE_SIZE,
    take: AUDIT_PAGE_SIZE,
  });

  const query = (patch: Record<string, string | number>) => {
    const params = new URLSearchParams();
    const merged: Record<string, string | number> = { action: filters.action, actor: filters.actor, from: filters.from, to: filters.to, ...patch };
    for (const [k, v] of Object.entries(merged)) if (v !== "" && !(k === "page" && v === 1)) params.set(k, String(v));
    const s = params.toString();
    return s ? `?${s}` : "";
  };
  const filtered = !!(filters.action || filters.actor || filters.from || filters.to);
  const retention = auditRetentionDays();
  const label = "text-sm text-ink-muted";
  const cellLabel = "sm:hidden text-xs text-ink-muted block";

  return (
    <div className="space-y-4">
      <header className="flex items-end justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-semibold">{t("adminAudit", locale)}</h1>
          <p className="text-sm text-ink-muted mt-0.5">
            {retention === 0
              ? t("auditRetentionForever", locale)
              : t("auditRetention", locale).replace("{days}", String(retention))}
          </p>
        </div>
        <a href={`/api/admin/audit/export${query({ page: 1 })}`} className={buttonClass("secondary", "md")} download>
          <Download size={16} aria-hidden />
          {t("auditDownloadCsv", locale)}
        </a>
      </header>

      <form
        method="get"
        role="search"
        aria-label={t("auditFilters", locale)}
        className="bg-surface border border-line rounded-panel p-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-[1fr_1fr_auto_auto_auto] items-end"
      >
        <label className="block">
          <span className={label}>{t("auditAction", locale)}</span>
          <select name="action" defaultValue={filters.action} className="mt-1">
            <option value="">{t("auditAllActions", locale)}</option>
            {options.actions.map((a) => (
              <option key={a} value={a}>
                {auditActionLabel(a, locale)}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className={label}>{t("auditActor", locale)}</span>
          <select name="actor" defaultValue={filters.actor} className="mt-1">
            <option value="">{t("auditAllActors", locale)}</option>
            {options.actors.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className={label}>{t("auditFrom", locale)}</span>
          <input type="date" name="from" defaultValue={filters.from} className="mt-1" />
        </label>
        <label className="block">
          <span className={label}>{t("auditTo", locale)}</span>
          <input type="date" name="to" defaultValue={filters.to} className="mt-1" />
        </label>
        <div className="flex gap-2">
          <button className={buttonClass("primary", "md", "h-9")}>{t("auditApply", locale)}</button>
          {filtered && (
            <Link href="/admin/audit" className={buttonClass("ghost", "md", "h-9")}>
              {t("auditReset", locale)}
            </Link>
          )}
        </div>
      </form>

      <p className="text-sm text-ink-muted" aria-live="polite">
        {t("auditCount", locale).replace("{count}", String(total))}
      </p>

      {entries.length === 0 ? (
        <div className="bg-surface border border-line rounded-panel p-6 text-center text-ink-muted">
          {filtered ? t("auditEmptyFiltered", locale) : t("auditEmpty", locale)}
        </div>
      ) : (
        <div className="bg-surface border border-line rounded-panel overflow-hidden">
          <table className="w-full text-sm">
            <caption className="sr-only">{t("adminAudit", locale)}</caption>
            <thead className="hidden sm:table-header-group bg-paper text-ink-muted text-left">
              <tr>
                <th scope="col" className="px-3 py-2 font-medium">{t("auditTime", locale)}</th>
                <th scope="col" className="px-3 py-2 font-medium">{t("auditActor", locale)}</th>
                <th scope="col" className="px-3 py-2 font-medium">{t("auditAction", locale)}</th>
                <th scope="col" className="px-3 py-2 font-medium">{t("auditTarget", locale)}</th>
                <th scope="col" className="px-3 py-2 font-medium">{t("auditIp", locale)}</th>
                <th scope="col" className="px-3 py-2 font-medium">{t("auditDetails", locale)}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {entries.map((e) => {
                const details = Object.entries(auditDetails(e.details));
                const danger = e.action === "login.failure" || e.action.endsWith(".delete");
                return (
                  <tr key={e.id} className="block sm:table-row px-3 py-2 sm:p-0 align-top">
                    <td className="block sm:table-cell sm:px-3 sm:py-2 whitespace-nowrap tabular-nums">
                      <span className={cellLabel}>{t("auditTime", locale)}</span>
                      <RelativeTime iso={e.createdAt.toISOString()} locale={locale} />
                    </td>
                    <td className="block sm:table-cell sm:px-3 sm:py-2">
                      <span className={cellLabel}>{t("auditActor", locale)}</span>
                      {e.actorName ? (
                        <span className="font-medium">{e.actorName}</span>
                      ) : (
                        <span className="text-ink-muted">{t("auditNoActor", locale)}</span>
                      )}
                    </td>
                    <td className="block sm:table-cell sm:px-3 sm:py-2">
                      <span className={cellLabel}>{t("auditAction", locale)}</span>
                      <span className={danger ? "text-danger font-medium" : ""}>{auditActionLabel(e.action, locale)}</span>
                    </td>
                    <td className="block sm:table-cell sm:px-3 sm:py-2 break-words">
                      <span className={cellLabel}>{t("auditTarget", locale)}</span>
                      {e.targetType ? (
                        <>
                          <span className="text-ink-muted">{auditTargetLabel(e.targetType, locale)}</span>
                          {e.targetName && <span> {e.targetName}</span>}
                        </>
                      ) : (
                        <span className="text-ink-muted">{t("none", locale)}</span>
                      )}
                    </td>
                    <td className="block sm:table-cell sm:px-3 sm:py-2 tabular-nums break-all">
                      <span className={cellLabel}>{t("auditIp", locale)}</span>
                      {e.ip ?? <span className="text-ink-muted">{t("none", locale)}</span>}
                    </td>
                    <td className="block sm:table-cell sm:px-3 sm:py-2">
                      <span className={cellLabel}>{t("auditDetails", locale)}</span>
                      {details.length === 0 ? (
                        <span className="text-ink-muted">{t("none", locale)}</span>
                      ) : (
                        <details>
                          <summary className="cursor-pointer text-accent min-h-6 inline-flex items-center">
                            {t("auditShowDetails", locale)}
                          </summary>
                          <dl className="mt-1 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-xs">
                            {details.map(([k, v]) => (
                              <div key={k} className="contents">
                                <dt className="text-ink-muted">{k}</dt>
                                <dd className="break-all">{detailValue(v)}</dd>
                              </div>
                            ))}
                          </dl>
                        </details>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {pages > 1 && (
        <nav aria-label={t("auditPagination", locale)} className="flex items-center justify-between gap-3">
          {page > 1 ? (
            <Link href={`/admin/audit${query({ page: page - 1 })}`} className={buttonClass("secondary", "md")} rel="prev">
              {t("auditNewer", locale)}
            </Link>
          ) : (
            <span />
          )}
          <span className="text-sm text-ink-muted tabular-nums">
            {t("auditPage", locale).replace("{page}", String(page)).replace("{pages}", String(pages))}
          </span>
          {page < pages ? (
            <Link href={`/admin/audit${query({ page: page + 1 })}`} className={buttonClass("secondary", "md")} rel="next">
              {t("auditOlder", locale)}
            </Link>
          ) : (
            <span />
          )}
        </nav>
      )}
    </div>
  );
}
