"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { loginAction } from "@/server/auth-actions";

const initial: { error?: string } = {};

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="w-full rounded-control bg-accent hover:bg-accent-hover text-accent-fg py-2.5 font-medium transition disabled:opacity-60 flex items-center justify-center gap-2"
    >
      {pending && (
        <span className="w-4 h-4 rounded-full border-2 border-accent-fg/70 border-t-transparent animate-spin" />
      )}
      <span>{pending ? "Signing in..." : "Sign in"}</span>
    </button>
  );
}

export default function LoginForm({ from }: { from: string }) {
  const [state, formAction] = useActionState(loginAction, initial);
  return (
    <form action={formAction} className="space-y-4" autoComplete="on">
      <input type="hidden" name="from" value={from} />
      <label className="block">
        <span className="text-sm font-medium text-ink-muted">Username</span>
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
        <span className="text-sm font-medium text-ink-muted">Password</span>
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
          className="text-sm text-danger bg-danger/10 border border-danger/40 rounded-control px-3 py-2"
          role="alert"
        >
          {state.error}
        </p>
      )}
      <SubmitButton />
    </form>
  );
}
