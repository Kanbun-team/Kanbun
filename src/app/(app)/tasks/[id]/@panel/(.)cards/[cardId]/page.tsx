import CardDetail from "@/components/card/CardDetail";
import CardSheet from "@/components/card/CardSheet";
import { getLocale } from "@/lib/get-locale";

export const dynamic = "force-dynamic";

export default async function CardPanel({ params }: { params: Promise<{ id: string; cardId: string }> }) {
  const { id, cardId } = await params;
  const locale = await getLocale();
  return (
    <CardSheet href={`/tasks/${id}/cards/${cardId}`} boardHref={`/tasks/${id}`} locale={locale}>
      <CardDetail boardId={id} cardId={cardId} variant="panel" />
    </CardSheet>
  );
}
