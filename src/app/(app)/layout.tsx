import { redirect } from "next/navigation";
import { safeAuth } from "@/auth";
import AppNav from "@/components/AppNav";
import Footer from "@/components/Footer";
import SessionPing from "@/components/SessionPing";
import { getLocale } from "@/lib/get-locale";
import UiProvider from "@/components/ui/UiProvider";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const result = await safeAuth();
  if (result.status === "bad-cookie") redirect("/api/auth/clear?to=/login");
  if (result.status === "anonymous") redirect("/login");

  const locale = await getLocale();

  return (
    <UiProvider locale={locale}>
    <div className="group/app min-h-screen flex flex-col">
      <AppNav locale={locale} />
      <main className="flex-1 mx-auto w-full max-w-7xl has-[[data-wide]]:max-w-none px-4 sm:px-6 py-6">
        {children}
      </main>
      <Footer locale={locale} />
      <SessionPing />
    </div>
    </UiProvider>
  );
}
