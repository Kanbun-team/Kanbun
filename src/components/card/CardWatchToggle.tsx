import { prisma } from "@/lib/db-local";
import WatchButton from "@/components/WatchButton";

// Server wrapper for the card header: looks up whether `userId` watches the card.
export default async function CardWatchToggle({ cardId, userId }: { cardId: string; userId: string }) {
  const row = await prisma.cardWatcher.findUnique({
    where: { cardId_userId: { cardId, userId } },
    select: { cardId: true },
  });
  // ml-auto: sits at the right of the header, next to the delete button.
  return (
    <div className="ml-auto">
      <WatchButton kind="card" id={cardId} watching={!!row} />
    </div>
  );
}
