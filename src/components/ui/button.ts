import { cn } from "@/lib/utils";

// Class builder rather than a component, so server components, <Link> and
// native <button>s can all share the same look without becoming client code.
export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
export type ButtonSize = "sm" | "md" | "lg";

const VARIANTS: Record<ButtonVariant, string> = {
  primary: "bg-accent text-accent-fg hover:bg-accent-hover",
  secondary: "border border-line-strong bg-surface text-ink hover:bg-paper",
  ghost: "text-ink-muted hover:text-ink hover:bg-ink/5",
  danger: "border border-danger/40 text-danger hover:bg-danger/10",
};

const SIZES: Record<ButtonSize, string> = {
  sm: "h-7 px-2.5 text-sm gap-1.5",
  md: "h-8 px-3 text-base gap-2",
  lg: "h-10 px-4 text-base gap-2",
};

export function buttonClass(variant: ButtonVariant = "secondary", size: ButtonSize = "md", extra?: string) {
  return cn(
    "inline-flex items-center justify-center rounded-control font-medium whitespace-nowrap transition-colors duration-[120ms] disabled:pointer-events-none",
    VARIANTS[variant],
    SIZES[size],
    extra
  );
}

export function iconButtonClass(extra?: string) {
  return cn(
    "inline-flex items-center justify-center rounded-control w-8 h-8 text-ink-muted hover:text-ink hover:bg-ink/5 transition-colors duration-[120ms]",
    extra
  );
}
