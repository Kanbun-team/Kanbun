import type { CSSProperties } from "react";
import { chipStyle } from "@/lib/palette";
import { cn } from "@/lib/utils";

// Sentence-case tag chip with contrast-checked colors in both themes.
export default function TagChip({ name, color, className }: { name: string; color: string; className?: string }) {
  return (
    <span
      className={cn("chip inline-flex items-center rounded-control px-1.5 py-px text-xs font-medium max-w-full truncate", className)}
      style={chipStyle(color) as CSSProperties}
    >
      {name}
    </span>
  );
}
