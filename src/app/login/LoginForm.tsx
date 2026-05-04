"use client";

import { useFormState, useFormStatus } from "react-dom";
import { loginAction } from "@/server/auth-actions";

const initial: { error?: string } = {};

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="w-full rounded-lg bg-brand-600 hover:bg-brand-700 active:bg-brand-800 text-white py-2.5 font-medium transition disabled:opacity-60 flex items-center justify-center gap-2"
    >
      {pending && (
        <span className="w-4 h-4 rounded-full border-2 border-white/70 border-t-transparent animate-spin" />
      )}
      <span>{pending ? "Signing in..." : "Sign in"}</span>
    </button>
  );
}

export default function LoginForm({ from }: { from: string }) {
  const [state, formAction] = useFormState(loginAction, initial);
  return (
    <form action={formAction} className="space-y-4" autoComplete="on">
      <input type="hidden" name="from" value={from} />
      <label className="block">
        <span className="text-sm font-medium opacity-80">Username</span>
        <input
          name="username"
          autoComplete="username"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          required
          autoFocus
          className="mt-1.5"
        />
      </label>
      <label className="block">
        <span className="text-sm font-medium opacity-80">Password</span>
        <input
          name="password"
          type="password"
          autoComplete="current-password"
          required
          className="mt-1.5"
        />
      </label>
      {state?.error && (
        <p
          className="text-sm text-red-500 bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900/50 rounded-md px-3 py-2"
          role="alert"
        >
          {state.error}
        </p>
      )}
      <SubmitButton />
    </form>
  );
}
