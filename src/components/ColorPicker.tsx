"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";

interface Props {
  name: string;
  defaultValue?: string;
  className?: string;
  swatchSize?: number;
  presets?: string[];
}

const DEFAULT_PRESETS = [
  "#2563eb",
  "#7c3aed",
  "#16a34a",
  "#dc2626",
  "#ea580c",
  "#0891b2",
  "#db2777",
  "#65a30d",
  "#475569",
];

export default function ColorPicker({
  name,
  defaultValue = "#2563eb",
  className,
  swatchSize = 36,
  presets = DEFAULT_PRESETS,
}: Props) {
  const [value, setValue] = useState(normalize(defaultValue));

  return (
    <div className={cn("flex flex-wrap items-center gap-2", className)}>
      <label
        className="relative shrink-0 rounded-lg overflow-hidden border border-[var(--border)] cursor-pointer block"
        style={{ width: swatchSize, height: swatchSize, background: value }}
        title={value.toUpperCase()}
      >
        <input
          type="color"
          name={name}
          value={value}
          onChange={(e) => setValue(normalize(e.target.value))}
          className="absolute inset-0 opacity-0 cursor-pointer w-full h-full"
        />
      </label>
      <code className="text-xs font-mono opacity-70 select-all">{value.toUpperCase()}</code>
      {presets.length > 0 && (
        <div className="flex items-center gap-1 ml-auto">
          {presets.map((p) => {
            const norm = normalize(p);
            const active = norm.toLowerCase() === value.toLowerCase();
            return (
              <button
                key={norm}
                type="button"
                onClick={() => setValue(norm)}
                title={norm.toUpperCase()}
                className={cn(
                  "w-5 h-5 rounded-full ring-offset-1 ring-offset-[var(--bg-elev)] cursor-pointer transition",
                  active ? "ring-2 ring-brand-500" : "ring-1 ring-[var(--border)]"
                )}
                style={{ background: norm }}
                aria-label={`Pick ${norm}`}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}

function normalize(input: string): string {
  const trimmed = (input ?? "").trim();
  if (!trimmed) return "#2563eb";
  return trimmed.startsWith("#") ? trimmed : `#${trimmed}`;
}
