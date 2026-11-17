import CardDetail from "@/components/card/CardDetail";

export const dynamic = "force-dynamic";

export default async function CardDetailPage({ params }: { params: Promise<{ id: string; cardId: string }> }) {
  const { id, cardId } = await params;
  return <CardDetail boardId={id} cardId={cardId} variant="page" />;
}
