import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

// A short, friendly "nothing here yet" panel: an icon, one line of title, a
// sentence that teaches what goes here, and at most one primary action.
export default function EmptyState({
  icon,
  title,
  children,
  action,
  className,
}: {
  icon?: ReactNode;
  title: string;
  children?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center text-center gap-2 rounded-panel border border-dashed border-line-strong bg-surface px-6 py-10",
        className
      )}
    >
      {icon && (
        <span aria-hidden className="mb-1 inline-flex items-center justify-center w-10 h-10 rounded-full bg-accent-soft text-accent">
          {icon}
        </span>
      )}
      <h2 className="text-md font-semibold">{title}</h2>
      {children && <p className="text-base text-ink-muted max-w-prose">{children}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}
