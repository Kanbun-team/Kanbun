"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";

// Next.js can leave document.title empty when the card panel (a parallel,
// intercepted route) closes after the board was refreshed while it was open.
// While the board itself is shown, put its title back whenever it goes blank.
export default function BoardTitleKeeper({ boardPath, title }: { boardPath: string; title: string }) {
  const pathname = usePathname();
  useEffect(() => {
    if (pathname !== boardPath) return;
    const fix = () => {
      if (!document.title.trim()) document.title = title;
    };
    fix();
    const observer = new MutationObserver(fix);
    observer.observe(document.head, { childList: true, subtree: true, characterData: true });
    return () => observer.disconnect();
  }, [pathname, boardPath, title]);
  return null;
}
