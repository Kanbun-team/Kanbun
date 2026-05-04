import { t, type Locale } from "@/lib/i18n";

const MONTH_KEYS = [
  "monthJan",
  "monthFeb",
  "monthMar",
  "monthApr",
  "monthMay",
  "monthJun",
  "monthJul",
  "monthAug",
  "monthSep",
  "monthOct",
  "monthNov",
  "monthDec",
] as const;

type Bucket = { date: string; total: number; moves: number; comments: number; subtasks: number };

export interface HeatmapProps {
  startDate: Date;
  endDate: Date;
  buckets: Bucket[];
  locale: Locale;
}

function dateKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function intensityClass(total: number): string {
  if (total === 0) return "bg-slate-200/60 dark:bg-slate-700/40";
  if (total < 2) return "bg-brand-200 dark:bg-brand-900/60";
  if (total < 5) return "bg-brand-400 dark:bg-brand-700";
  if (total < 10) return "bg-brand-500 dark:bg-brand-600";
  return "bg-brand-700 dark:bg-brand-500";
}

export default function Heatmap({ startDate, endDate, buckets, locale }: HeatmapProps) {
  const map = new Map(buckets.map((b) => [b.date, b]));
  const cursor = new Date(startDate);
  cursor.setDate(cursor.getDate() - cursor.getDay());
  const weeks: { date: Date; bucket?: Bucket }[][] = [];
  while (cursor <= endDate) {
    const week: { date: Date; bucket?: Bucket }[] = [];
    for (let i = 0; i < 7; i += 1) {
      const d = new Date(cursor);
      week.push({ date: d, bucket: map.get(dateKey(d)) });
      cursor.setDate(cursor.getDate() + 1);
    }
    weeks.push(week);
  }

  const monthLabels: { col: number; label: string }[] = [];
  let lastMonth = -1;
  weeks.forEach((week, i) => {
    const m = week[0].date.getMonth();
    if (m !== lastMonth) {
      monthLabels.push({ col: i, label: t(MONTH_KEYS[m], locale) });
      lastMonth = m;
    }
  });

  return (
    <div className="overflow-x-auto">
      <div className="inline-block min-w-full">
        <div className="grid" style={{ gridTemplateColumns: `repeat(${weeks.length}, 12px)`, columnGap: 2 }}>
          {monthLabels.map((m) => (
            <div
              key={m.col}
              className="text-[10px] opacity-60"
              style={{ gridColumn: m.col + 1, gridRow: 1 }}
            >
              {m.label}
            </div>
          ))}
        </div>
        <div className="flex gap-[2px] mt-1">
          {weeks.map((week, wi) => (
            <div key={wi} className="flex flex-col gap-[2px]">
              {week.map((cell, di) => {
                const inRange = cell.date >= startDate && cell.date <= endDate;
                if (!inRange) return <div key={di} className="w-3 h-3" />;
                const total = cell.bucket?.total ?? 0;
                const tip = `${dateKey(cell.date)} - moves ${cell.bucket?.moves ?? 0}, comments ${cell.bucket?.comments ?? 0}, subtasks ${cell.bucket?.subtasks ?? 0}`;
                return (
                  <div
                    key={di}
                    title={tip}
                    className={`w-3 h-3 rounded-sm ${intensityClass(total)}`}
                  />
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
