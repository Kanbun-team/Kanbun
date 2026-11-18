import type { ReactNode } from "react";
import RecentBoardTracker from "@/components/home/RecentBoardTracker";

// `panel` shows a card in a side sheet over the board when it is opened from
// the board (an intercepted soft navigation). Direct visits and reloads of a
// card URL render the full card page instead.
export default async function BoardLayout({
  children,
  panel,
  params,
}: {
  children: ReactNode;
  panel: ReactNode;
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return (
    <>
      {children}
      {panel}
      <RecentBoardTracker boardId={id} />
    </>
  );
}
