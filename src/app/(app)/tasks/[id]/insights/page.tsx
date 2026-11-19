import Link from "next/link";
import { notFound } from "next/navigation";
import { BarChart3, Hourglass } from "lucide-react";
import { prisma } from "@/lib/db-local";
import { getLocale } from "@/lib/get-locale";
import { intlLocale, t, tn } from "@/lib/i18n";
import { CYCLE_BUCKETS_DAYS, WEEKS, formatDuration } from "@/lib/flow";
import { loadBoardAccess } from "@/server/board-access";
import { boardInsights } from "@/server/flow";
import { boardPageTitle } from "@/server/page-title";
import EmptyState from "@/components/ui/EmptyState";
import { BarChart, FlowChart, TableDisclosure, tableClass } from "@/components/insights/charts";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

const RANGES = [30, 90] as const;
/** Rows of the aging table; the rest is counted below it. */
const AGING_ROWS = 30;

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return boardPageTitle(id, "insightsTitle");
}

const fill = (text: string, vars: Record<string, string>) =>
  Object.entries(vars).reduce((s, [k, v]) => s.replaceAll(`{${k}}`, v), text);

export default async function InsightsPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ days?: string }>;
}) {
  const { id } = await params;
  try {
    await loadBoardAccess(id);
  } catch {
    notFound();
  }
  const { days: daysParam } = await searchParams;
  const flowDays = daysParam === "90" ? 90 : 30;
  const locale = await getLocale();
  const board = await prisma.board.findUnique({ where: { id }, select: { id: true, name: true } });
  if (!board) notFound();

  const { insights, titles } = await boardInsights(id, flowDays);
  const { columns } = insights;
  const nameOf = new Map(columns.map((c) => [c.id, c.name]));
  const dayFmt = new Intl.DateTimeFormat(intlLocale(locale), { month: "short", day: "numeric", timeZone: "UTC" });
  const longDayFmt = new Intl.DateTimeFormat(intlLocale(locale), { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" });
  const num = new Intl.NumberFormat(intlLocale(locale), { maximumFractionDigits: 1 });
  const list = (items: string[]) => new Intl.ListFormat(intlLocale(locale), { style: "long", type: "conjunction" }).format(items);
  const section = "rounded-panel border border-line bg-surface p-4 sm:p-6 space-y-3 min-w-0";
  const help = "text-sm text-ink-muted max-w-prose";

  const header = (
    <>
      <Link href={`/tasks/${id}`} className="text-sm text-ink-muted hover:text-ink">
        &larr; {board.name}
      </Link>
      <h1 className="text-xl font-semibold">{t("insightsTitle", locale)}</h1>
    </>
  );

  if (columns.length < 2 || insights.totalCards === 0) {
    return (
      <div className="space-y-6 max-w-5xl">
        {header}
        <EmptyState icon={<BarChart3 size={20} />} title={t("insightsTitle", locale)}>
          {t(columns.length < 2 ? "insightsNeedColumns" : "insightsEmpty", locale)}
        </EmptyState>
      </div>
    );
  }

  const first = columns[0].name;
  const done = columns[columns.length - 1].name;
  const twoColumns = columns.length === 2;

  // Cycle time.
  const { cycle } = insights;
  const bucketLabel = (i: number) =>
    i === 0
      ? t("insightsBucketUnder", locale)
      : i === CYCLE_BUCKETS_DAYS.length
        ? tn("insightsBucketOver", CYCLE_BUCKETS_DAYS[i - 1], locale)
        : tn("insightsBucketRange", CYCLE_BUCKETS_DAYS[i], locale).replace("{from}", String(CYCLE_BUCKETS_DAYS[i - 1]));
  const buckets = cycle.buckets.map((count, i) => ({ label: bucketLabel(i), count }));

  // Throughput.
  const thisWeek = insights.throughput.length - 1;
  const weekLabel = (i: number) => {
    const date = dayFmt.format(insights.throughput[i].weekStart);
    return i === thisWeek ? fill(t("insightsSoFar", locale), { date }) : fill(t("insightsWeekOf", locale), { date });
  };
  const finishedTotal = insights.throughput.reduce((s, w) => s + w.count, 0);

  // Cumulative flow.
  const flowLabels = insights.flow.map((d) => dayFmt.format(d.day));
  const today = insights.flow[insights.flow.length - 1];
  const flowSummary = fill(tn("insightsFlowSummary", flowDays, locale), {
    columns: list(columns.map((c, i) => `${c.name} ${today.counts[i]}`)),
  });

  // Aging work in progress.
  const aging = insights.aging.slice(0, AGING_ROWS);
  const maxAge = Math.max(1, ...aging.map((a) => a.ms));
  const workNames = insights.workColumnIds.map((c) => nameOf.get(c) ?? "");

  return (
    <div className="space-y-6 max-w-5xl">
      {header}
      <div className={cn(help, "space-y-1")}>
        <p>{t("insightsIntro", locale)}</p>
        {insights.historyStart !== null && (
          <p>
            {fill(t("insightsHistoryFrom", locale), { date: longDayFmt.format(insights.historyStart) })}
            {insights.partialCards > 0 && <> {tn("insightsHistoryPartial", insights.partialCards, locale)}</>}
          </p>
        )}
        {insights.historyStart === null && <p>{t("insightsHistoryNone", locale)}</p>}
        <p>{t("insightsScope", locale)}</p>
      </div>

      <section aria-labelledby="cycle-title" className={section}>
        <h2 id="cycle-title" className="text-lg font-semibold">
          {t("insightsCycleTitle", locale)}
        </h2>
        <p className={help}>
          {twoColumns
            ? fill(t("insightsCycleHelpTwo", locale), { done })
            : fill(t("insightsCycleHelp", locale), { first, done })}
        </p>
        {cycle.samples.length === 0 ? (
          <p className="text-sm">{t("insightsCycleNone", locale)}</p>
        ) : (
          <>
            <dl className="grid grid-cols-2 gap-3 max-w-md">
              {(
                [
                  ["insightsMedian", "insightsMedianHint", cycle.median],
                  ["insightsP85", "insightsP85Hint", cycle.p85],
                ] as const
              ).map(([label, hint, value]) => (
                <div key={label} className="rounded-card border border-line bg-raised p-3">
                  <dt className="text-sm text-ink-muted">{t(label, locale)}</dt>
                  <dd className="text-lg font-semibold tabular-nums" data-testid={label}>
                    {formatDuration(value ?? 0, locale)}
                  </dd>
                  <dd className="text-xs text-ink-muted">{t(hint, locale)}</dd>
                </div>
              ))}
            </dl>
            <p className="text-sm text-ink-muted">
              {tn("insightsFinished", cycle.samples.length, locale)}
              {cycle.skipped > 0 && <> {tn("insightsSkipped", cycle.skipped, locale).replace("{done}", done)}</>}
            </p>
            <h3 className="text-base font-medium pt-2">{t("insightsDistribution", locale)}</h3>
            <BarChart
              summary={`${t("insightsDistribution", locale)}: ${list(buckets.map((b) => `${b.label}: ${b.count}`))}`}
              bars={buckets.map((b, i) => ({ key: String(i), label: b.label, title: `${b.label}: ${b.count}`, value: b.count }))}
            />
            <TableDisclosure label={t("insightsShowTable", locale)}>
              <table className={tableClass}>
                <caption className="sr-only">{t("insightsDistribution", locale)}</caption>
                <thead>
                  <tr>
                    <th scope="col">{t("insightsTime", locale)}</th>
                    <th scope="col">{t("insightsCards", locale)}</th>
                  </tr>
                </thead>
                <tbody>
                  {buckets.map((b) => (
                    <tr key={b.label}>
                      <th scope="row" className="!text-ink !font-normal">{b.label}</th>
                      <td>{b.count}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableDisclosure>
          </>
        )}
        {cycle.samples.length === 0 && cycle.skipped > 0 && (
          <p className="text-sm text-ink-muted">{tn("insightsSkipped", cycle.skipped, locale).replace("{done}", done)}</p>
        )}
      </section>

      <section aria-labelledby="throughput-title" className={section}>
        <h2 id="throughput-title" className="text-lg font-semibold">
          {t("insightsThroughputTitle", locale)}
        </h2>
        <p className={help}>{fill(t("insightsThroughputHelp", locale), { done })}</p>
        <p className="text-sm" data-testid="throughput-summary">
          {tn("insightsThroughputSummary", finishedTotal, locale).replace("{average}", num.format(finishedTotal / WEEKS))}
        </p>
        <BarChart
          summary={`${t("insightsThroughputTitle", locale)}: ${list(insights.throughput.map((w, i) => `${weekLabel(i)}: ${w.count}`))}`}
          labelEvery={3}
          bars={insights.throughput.map((w, i) => ({
            key: String(w.weekStart),
            label: dayFmt.format(w.weekStart),
            title: `${weekLabel(i)}: ${w.count}`,
            value: w.count,
            dim: i === thisWeek,
          }))}
        />
        <TableDisclosure label={t("insightsShowTable", locale)}>
          <table className={tableClass}>
            <caption className="sr-only">{t("insightsThroughputTitle", locale)}</caption>
            <thead>
              <tr>
                <th scope="col">{t("insightsWeek", locale)}</th>
                <th scope="col">{t("insightsCards", locale)}</th>
              </tr>
            </thead>
            <tbody>
              {insights.throughput.map((w, i) => (
                <tr key={w.weekStart}>
                  <th scope="row" className="!text-ink !font-normal">{weekLabel(i)}</th>
                  <td>{w.count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableDisclosure>
      </section>

      <section aria-labelledby="flow-title" className={section}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id="flow-title" className="text-lg font-semibold">
            {t("insightsFlowTitle", locale)}
          </h2>
          <nav aria-label={t("insightsRange", locale)} className="flex rounded-control border border-line p-0.5 text-sm">
            {RANGES.map((d) => (
              <Link
                key={d}
                href={d === 30 ? `/tasks/${id}/insights` : `/tasks/${id}/insights?days=${d}`}
                scroll={false}
                aria-current={d === flowDays ? "page" : undefined}
                className={cn(
                  "rounded-control px-2.5 py-1",
                  d === flowDays ? "bg-accent-soft text-ink font-medium" : "text-ink-muted hover:text-ink hover:bg-ink/5"
                )}
              >
                {tn("insightsDays", d, locale)}
              </Link>
            ))}
          </nav>
        </div>
        <p className={help}>{t("insightsFlowHelp", locale)}</p>
        <FlowChart
          summary={flowSummary}
          legendLabel={t("insightsColumn", locale)}
          dayLabels={flowLabels}
          series={columns.map((c, i) => ({
            key: c.id,
            name: c.name,
            values: insights.flow.map((d) => d.counts[i]),
            done: i === columns.length - 1,
          }))}
        />
        <TableDisclosure label={t("insightsShowTable", locale)}>
          <table className={tableClass}>
            <caption className="sr-only">{t("insightsFlowTitle", locale)}</caption>
            <thead>
              <tr>
                <th scope="col">{t("insightsDate", locale)}</th>
                {columns.map((c) => (
                  <th key={c.id} scope="col">
                    {c.name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {[...insights.flow].reverse().map((d) => (
                <tr key={d.day}>
                  <th scope="row" className="!text-ink !font-normal whitespace-nowrap">{dayFmt.format(d.day)}</th>
                  {d.counts.map((n, i) => (
                    <td key={columns[i].id}>{n}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </TableDisclosure>
      </section>

      <section aria-labelledby="aging-title" className={section}>
        <h2 id="aging-title" className="text-lg font-semibold">
          {t("insightsAgingTitle", locale)}
        </h2>
        <p className={help}>{fill(t("insightsAgingHelp", locale), { columns: list(workNames) })}</p>
        {aging.length === 0 ? (
          <p className="text-sm">{t("insightsAgingNone", locale)}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className={tableClass}>
              <caption className="sr-only">{t("insightsAgingTitle", locale)}</caption>
              <thead>
                <tr>
                  <th scope="col">{t("insightsCard", locale)}</th>
                  <th scope="col">{t("insightsColumn", locale)}</th>
                  <th scope="col">{t("insightsAge", locale)}</th>
                </tr>
              </thead>
              <tbody>
                {aging.map((a) => (
                  <tr key={a.cardId}>
                    <th scope="row" className="!text-ink !font-normal max-w-[16rem]">
                      <Link href={`/tasks/${id}/cards/${a.cardId}`} className="hover:underline break-words">
                        {titles.get(a.cardId)}
                      </Link>
                    </th>
                    <td>{nameOf.get(a.columnId)}</td>
                    <td className="min-w-[9rem] w-1/3">
                      <span className="flex flex-wrap items-center gap-x-1.5">
                        <span className="whitespace-nowrap">
                        {formatDuration(a.ms, locale)}</span>
                        {a.over && (
                          <span className="inline-flex items-center gap-1 text-ink-muted">
                            <Hourglass size={14} aria-hidden />
                            {t("insightsOverUsual", locale)}
                          </span>
                        )}
                      </span>
                      <span aria-hidden className="mt-1 block h-1.5 rounded-full bg-line">
                        <span className="block h-full rounded-full bg-accent" style={{ width: `${Math.max(2, (a.ms / maxAge) * 100)}%` }} />
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {insights.aging.length > AGING_ROWS && (
          <p className="text-sm text-ink-muted">{tn("insightsAgingMore", insights.aging.length - AGING_ROWS, locale)}</p>
        )}

        <h3 className="text-base font-medium pt-2">{t("insightsUsualTitle", locale)}</h3>
        <p className={help}>{t("insightsUsualHelp", locale)}</p>
        <div className="overflow-x-auto">
          <table className={tableClass}>
            <caption className="sr-only">{t("insightsUsualTitle", locale)}</caption>
            <thead>
              <tr>
                <th scope="col">{t("insightsColumn", locale)}</th>
                <th scope="col">{t("insightsUsual", locale)}</th>
                <th scope="col">{t("insightsUsualSamples", locale)}</th>
              </tr>
            </thead>
            <tbody>
              {insights.workColumnIds.map((cid) => {
                const u = insights.usual.get(cid);
                return (
                  <tr key={cid}>
                    <th scope="row" className="!text-ink !font-normal">{nameOf.get(cid)}</th>
                    <td>{u?.p85 != null ? formatDuration(u.p85, locale) : t("insightsUsualNone", locale)}</td>
                    <td>{u?.samples ?? 0}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
