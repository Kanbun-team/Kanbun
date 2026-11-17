"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import { PALETTE } from "@/lib/palette";

interface Props {
  name: string;
  defaultValue?: string;
  className?: string;
  swatchSize?: number;
  presets?: string[];
}

const DEFAULT_PRESETS: string[] = [...PALETTE];

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
        className="relative shrink-0 rounded-control overflow-hidden border border-line cursor-pointer block"
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
      <code className="text-xs font-mono text-ink-muted select-all">{value.toUpperCase()}</code>
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
                  "w-5 h-5 rounded-full ring-offset-1 ring-offset-surface cursor-pointer transition",
                  active ? "ring-2 ring-accent" : "ring-1 ring-line"
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
