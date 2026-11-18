import CardDetail from "@/components/card/CardDetail";
import { cardTitle } from "@/server/page-title";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ id: string; cardId: string }> }) {
  const { id, cardId } = await params;
  return cardTitle(id, cardId);
}

export default async function CardDetailPage({ params }: { params: Promise<{ id: string; cardId: string }> }) {
  const { id, cardId } = await params;
  return <CardDetail boardId={id} cardId={cardId} variant="page" />;
}
