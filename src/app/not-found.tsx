import Link from "next/link";
import { t } from "@/lib/i18n";
import { getLocale } from "@/lib/get-locale";
import StatusPage from "@/components/StatusPage";
import { buttonClass } from "@/components/ui/button";

export default async function NotFound() {
  const locale = await getLocale();
  return (
    <StatusPage title={t("notFoundTitle", locale)} body={t("notFoundBody", locale)}>
      <title>{`${t("notFoundTitle", locale)} · Kanbun`}</title>
      <Link href="/tasks" className={buttonClass("primary")}>
        {t("backToBoards", locale)}
      </Link>
    </StatusPage>
  );
}
