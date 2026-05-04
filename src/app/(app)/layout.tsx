import { redirect } from "next/navigation";
import { safeAuth } from "@/auth";
import AppNav from "@/components/AppNav";
import Footer from "@/components/Footer";
import SessionPing from "@/components/SessionPing";
import { getLocale } from "@/lib/get-locale";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const result = await safeAuth();
  if (result.status === "bad-cookie") redirect("/api/auth/clear?to=/login");
  if (result.status === "anonymous") redirect("/login");

  const user = result.session.user;
  const locale = await getLocale();
  const canSeeTasks = user.accessTasks || user.role === "admin";

  return (
    <div className="min-h-screen flex flex-col">
      <AppNav locale={locale} />
      <main className="flex-1 mx-auto w-full max-w-7xl px-4 sm:px-6 py-6">
        {canSeeTasks ? children : (
          <div className="surface border rounded-xl p-6">
            <p className="opacity-80 text-sm">
              You do not have access to this panel. Ask an administrator.
            </p>
          </div>
        )}
      </main>
      <Footer locale={locale} />
      <SessionPing />
    </div>
  );
}
