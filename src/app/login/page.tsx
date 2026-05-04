import { Suspense } from "react";
import { redirect } from "next/navigation";
import { safeAuth } from "@/auth";
import Logo from "@/components/Logo";
import LoginForm from "./LoginForm";

export const metadata = { title: "Log in - Kanbun" };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; error?: string }>;
}) {
  const sp = await searchParams;
  const result = await safeAuth();
  if (result.status === "bad-cookie") {
    redirect("/api/auth/clear?to=/login");
  }
  if (result.status === "ok") {
    redirect("/tasks");
  }
  return (
    <main className="min-h-screen flex items-center justify-center px-4 py-10 safe-top safe-bottom bg-gradient-to-br from-slate-50 via-white to-brand-50 dark:from-slate-950 dark:via-slate-900 dark:to-brand-950">
      <div className="w-full max-w-sm">
        <div className="flex flex-col items-center mb-8">
          <Logo size={56} />
          <h1 className="text-3xl font-semibold mt-3 tracking-tight">Kanbun</h1>
          <p className="text-sm opacity-70 mt-1">Self-hosted task boards</p>
        </div>
        <div className="surface border rounded-2xl p-6 shadow-xl backdrop-blur">
          <h2 className="text-base font-medium mb-4">Sign in</h2>
          <Suspense fallback={null}>
            <LoginForm from={sp?.from ?? "/tasks"} />
          </Suspense>
        </div>
        <p className="text-xs text-center opacity-60 mt-6">
          Need an account? Ask your administrator.
        </p>
      </div>
    </main>
  );
}
