import type { ReactNode } from "react";

// `panel` shows a card in a side sheet over the board when it is opened from
// the board (an intercepted soft navigation). Direct visits and reloads of a
// card URL render the full card page instead.
export default function BoardLayout({ children, panel }: { children: ReactNode; panel: ReactNode }) {
  return (
    <>
      {children}
      {panel}
    </>
  );
}
