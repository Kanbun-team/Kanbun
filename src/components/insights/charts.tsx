import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

// Hand-written SVG charts for the board insights page. Server components, no
// chart library. The marks are in an SVG that stretches to the width
// (preserveAspectRatio="none"); every text is HTML around it, so labels keep
// their size at 390px. Each chart has an accessible summary (aria-label) and
// the page shows the same numbers as a table.

/** A round axis maximum at or above `max` (1, 2, 5, 10, 20, 50, ...). */
export function niceMax(max: number): number {
  if (max <= 0) return 1;
  const step = 10 ** Math.floor(Math.log10(max));
  for (const m of [1, 2, 5, 10]) if (m * step >= max) return m * step;
  return 10 * step;
}

function YAxis({ max }: { max: number }) {
  return (
    <div aria-hidden className="flex flex-col justify-between text-xs text-ink-muted tabular-nums text-right w-8 shrink-0 -my-2">
      <span>{max}</span>
      <span>{max / 2}</span>
      <span>0</span>
    </div>
  );
}

function Grid() {
  return (
    <>
      {[0, 50].map((y) => (
        <line key={y} x1="0" x2="100%" y1={y} y2={y} className="stroke-line" strokeWidth={1} vectorEffect="non-scaling-stroke" />
      ))}
      <line x1="0" x2="100%" y1={100} y2={100} className="stroke-line-strong" strokeWidth={1} vectorEffect="non-scaling-stroke" />
    </>
  );
}

export type Bar = { key: string; label: string; title: string; value: number; dim?: boolean };

/** Vertical bars, one per item, with a label under each (only some on phones). */
export function BarChart({ bars, summary, labelEvery = 1 }: { bars: Bar[]; summary: string; labelEvery?: number }) {
  const max = niceMax(Math.max(0, ...bars.map((b) => b.value)));
  const n = bars.length;
  return (
    <div>
      <div className="flex gap-2">
        <YAxis max={max} />
        <svg
          role="img"
          aria-label={summary}
          viewBox={`0 0 ${n * 10} 100`}
          preserveAspectRatio="none"
          className="h-40 flex-1 min-w-0 overflow-visible"
        >
          <Grid />
          {bars.map((b, i) => {
            const h = (b.value / max) * 100;
            return (
              <rect
                key={b.key}
                x={i * 10 + 1.5}
                width={7}
                y={100 - h}
                height={h}
                className={cn("fill-accent", b.dim && "opacity-60")}
              >
                <title>{b.title}</title>
              </rect>
            );
          })}
        </svg>
      </div>
      <div aria-hidden className="ml-10 mt-1 grid text-xs text-ink-muted" style={{ gridTemplateColumns: `repeat(${n}, minmax(0, 1fr))` }}>
        {bars.map((b, i) => (
          <span
            key={b.key}
            // Skipped labels keep their grid cell (invisible, not hidden) so the
            // others stay under their bars.
            className={cn(
              "text-center break-words",
              labelEvery > 1 && "whitespace-nowrap",
              i % labelEvery !== 0 && "invisible sm:visible"
            )}
          >
            {b.label}
          </span>
        ))}
      </div>
    </div>
  );
}

export type FlowSeries = { key: string; name: string; values: number[]; done: boolean };

/** Fill opacity of the accent for non-done bands: lighter for earlier columns. */
function bandOpacity(index: number, count: number): number {
  if (count <= 1) return 0.85;
  return 0.25 + (0.6 * index) / (count - 1);
}

/**
 * Stacked areas, one band per column: the last column (Done) at the bottom,
 * the first on top, as cumulative flow charts are read.
 */
export function FlowChart({
  series,
  dayLabels,
  summary,
  legendLabel,
}: {
  series: FlowSeries[];
  dayLabels: string[];
  summary: string;
  legendLabel: string;
}) {
  const days = dayLabels.length;
  const totals = Array.from({ length: days }, (_, d) => series.reduce((s, c) => s + c.values[d], 0));
  const max = niceMax(Math.max(0, ...totals));
  const width = Math.max(1, days - 1) * 10;
  const x = (d: number) => (days === 1 ? width / 2 : d * 10);
  const y = (v: number) => 100 - (v / max) * 100;

  // Bottom to top: last column first.
  const stack = [...series].reverse();
  const below = new Array<number>(days).fill(0);
  const work = series.filter((s) => !s.done);
  const bands = stack.map((s) => {
    const lower = [...below];
    for (let d = 0; d < days; d++) below[d] += s.values[d];
    const upper = [...below];
    const top = upper.map((v, d) => `${x(d)},${y(v)}`);
    const bottom = lower.map((v, d) => `${x(d)},${y(v)}`).reverse();
    return { s, points: [...top, ...bottom].join(" ") };
  });
  const color = (s: FlowSeries) =>
    s.done ? { className: "fill-success", opacity: 0.85 } : { className: "fill-accent", opacity: bandOpacity(work.indexOf(s), work.length) };

  const tick = (d: number) => dayLabels[d];
  return (
    <div>
      <div className="flex gap-2">
        <YAxis max={max} />
        <svg role="img" aria-label={summary} viewBox={`0 0 ${width} 100`} preserveAspectRatio="none" className="h-48 flex-1 min-w-0 overflow-visible">
          <Grid />
          {bands.map(({ s, points }) => {
            const c = color(s);
            return (
              <polygon
                key={s.key}
                points={points}
                className={cn(c.className, "stroke-surface")}
                fillOpacity={c.opacity}
                strokeWidth={1.5}
                strokeLinejoin="round"
                vectorEffect="non-scaling-stroke"
              >
                <title>{`${s.name}: ${s.values[days - 1]}`}</title>
              </polygon>
            );
          })}
        </svg>
      </div>
      <div aria-hidden className="ml-10 mt-1 flex justify-between text-xs text-ink-muted tabular-nums">
        <span>{tick(0)}</span>
        {days > 2 && <span>{tick(Math.floor((days - 1) / 2))}</span>}
        <span>{tick(days - 1)}</span>
      </div>
      {/* Legend, top band first, as on the chart. */}
      <ul aria-label={legendLabel} className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-sm">
        {series.map((s) => {
          const c = color(s);
          return (
            <li key={s.key} className="inline-flex items-center gap-1.5">
              <svg aria-hidden width="12" height="12" className="shrink-0">
                <rect width="12" height="12" rx="3" className={c.className} fillOpacity={c.opacity} />
              </svg>
              {s.name}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** A table under a "Show as a table" disclosure. */
export function TableDisclosure({ label, children }: { label: string; children: ReactNode }) {
  return (
    <details className="mt-3 group">
      <summary className="cursor-pointer text-sm text-accent hover:underline w-fit rounded-control">{label}</summary>
      <div className="mt-2 overflow-x-auto">{children}</div>
    </details>
  );
}

export const tableClass = "w-full text-sm tabular-nums [&_th]:text-left [&_th]:font-medium [&_th]:text-ink-muted [&_th]:py-1 [&_th]:pr-4 [&_td]:py-1 [&_td]:pr-4 [&_tr]:border-b [&_tr]:border-line";
