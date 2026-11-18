"use client";

import { useEffect } from "react";
import { RECENT_BOARDS_COOKIE, pushRecentBoard } from "@/lib/recent-boards";

function readCookie(name: string): string | undefined {
  const prefix = `${name}=`;
  return document.cookie
    .split("; ")
    .find((part) => part.startsWith(prefix))
    ?.slice(prefix.length);
}

// Records the board as recently opened for the boards home. Renders nothing.
export default function RecentBoardTracker({ boardId }: { boardId: string }) {
  useEffect(() => {
    try {
      const next = pushRecentBoard(readCookie(RECENT_BOARDS_COOKIE), boardId);
      document.cookie = `${RECENT_BOARDS_COOKIE}=${next}; path=/; max-age=31536000; samesite=lax`;
    } catch {
      // Cookies blocked: the "Recently opened" row simply stays empty.
    }
  }, [boardId]);
  return null;
}
