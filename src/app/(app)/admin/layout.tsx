import { redirect } from "next/navigation";
import { requirePageUser } from "@/auth";
import AdminTabs from "@/components/AdminTabs";
import { getLocale } from "@/lib/get-locale";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const user = await requirePageUser();
  if (user.role !== "admin") redirect("/tasks");
  const locale = await getLocale();
  return (
    <div className="space-y-6">
      <AdminTabs locale={locale} />
      {children}
    </div>
  );
}
