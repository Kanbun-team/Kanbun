"use client";

import type { ReactNode } from "react";
import {
  Button,
  Menu as AriaMenu,
  MenuItem as AriaMenuItem,
  MenuTrigger,
  Popover,
  Separator,
  SubmenuTrigger,
  type MenuItemProps,
} from "react-aria-components";
import { Check, ChevronRight, MoreHorizontal } from "lucide-react";
import { cn } from "@/lib/utils";

// Keyboard-accessible menus (React Aria): arrow keys, typeahead, Escape,
// submenus. Destructive items go last, after a separator, in `danger` style.

const popoverClass =
  "min-w-[12rem] max-w-[18rem] max-h-[min(24rem,var(--visual-viewport-height))] overflow-auto rounded-panel border border-line bg-raised text-ink shadow-float py-1 outline-none text-base";

/** The look of a menu's trigger button (also used by stand-ins for it). */
export const menuButtonClass =
  "inline-flex items-center justify-center rounded-control w-7 h-7 text-ink-muted hover:text-ink hover:bg-ink/5 outline-none focus-visible:ring-2 focus-visible:ring-accent pressed:bg-ink/10";

export function MenuButton({
  label,
  children,
  isOpen,
  onOpenChange,
  className,
  icon,
  autoFocus,
}: {
  label: string;
  children: ReactNode;
  isOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  className?: string;
  icon?: ReactNode;
  autoFocus?: boolean;
}) {
  return (
    <MenuTrigger isOpen={isOpen} onOpenChange={onOpenChange}>
      <Button aria-label={label} autoFocus={autoFocus} className={cn(menuButtonClass, className)}>
        {icon ?? <MoreHorizontal size={16} aria-hidden />}
      </Button>
      <Popover placement="bottom end" className={popoverClass}>
        <AriaMenu aria-label={label} className="outline-none">
          {children}
        </AriaMenu>
      </Popover>
    </MenuTrigger>
  );
}

export function MenuItem({
  children,
  danger,
  checked,
  className,
  ...props
}: Omit<MenuItemProps, "children"> & { children: ReactNode; danger?: boolean; checked?: boolean }) {
  return (
    <AriaMenuItem
      {...props}
      className={cn(
        "flex items-center gap-2 px-3 py-1.5 cursor-default outline-none select-none",
        "focus:bg-ink/5 hover:bg-ink/5",
        danger && "text-danger focus:bg-danger/10 hover:bg-danger/10",
        className
      )}
    >
      {({ hasSubmenu }) => (
        <>
          <span className="flex-1 min-w-0 flex items-center gap-2 truncate">{children}</span>
          {checked && <Check size={14} aria-hidden className="text-accent shrink-0" />}
          {hasSubmenu && <ChevronRight size={14} aria-hidden className="text-ink-muted shrink-0" />}
        </>
      )}
    </AriaMenuItem>
  );
}

export function Submenu({ label, children }: { label: ReactNode; children: ReactNode }) {
  return (
    <SubmenuTrigger>
      <MenuItem>{label}</MenuItem>
      <Popover offset={-4} crossOffset={-4} className={popoverClass}>
        <AriaMenu className="outline-none">{children}</AriaMenu>
      </Popover>
    </SubmenuTrigger>
  );
}

export function MenuSeparator() {
  return <Separator className="my-1 border-t border-line" />;
}
