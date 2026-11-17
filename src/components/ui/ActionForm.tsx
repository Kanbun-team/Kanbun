"use client";

import { useRef, useTransition, type ComponentProps } from "react";
import { useRouter } from "next/navigation";
import type { ActionResult } from "@/lib/action-result";
import { useUi, type ConfirmOptions } from "./UiProvider";
import { useUndo } from "./useUndo";

type FormProps = Omit<ComponentProps<"form">, "action" | "onSubmit">;

// A <form> for typed server actions that server components can render.
// Failures show a translated toast instead of an error page; optional
// confirmation, success toast, undo (for deletes that return a trash id),
// form reset and redirect are configured with serializable props.
export default function ActionForm({
  action,
  confirm,
  success,
  undo,
  resetOnSuccess,
  redirectTo,
  children,
  ...props
}: FormProps & {
  action: (fd: FormData) => Promise<ActionResult<unknown>>;
  confirm?: ConfirmOptions;
  success?: string;
  undo?: boolean;
  resetOnSuccess?: boolean;
  redirectTo?: string;
}) {
  const ui = useUi();
  const offerUndo = useUndo();
  const router = useRouter();
  const ref = useRef<HTMLFormElement>(null);
  const [pending, startTransition] = useTransition();

  // The confirm dialog must open outside the transition: React commits state
  // updates made inside an async transition only when the transition ends.
  async function submit(fd: FormData) {
    if (confirm && !(await ui.confirm(confirm))) return;
    startTransition(async () => {
      const result = ui.report(await action(fd));
      if (!result.ok) return;
      if (resetOnSuccess) ref.current?.reset();
      if (redirectTo) router.push(redirectTo);
      const trashId = (result.data as { trashId?: string } | undefined)?.trashId;
      if (undo && trashId) offerUndo(success ?? "", trashId);
      else if (success) ui.toast({ message: success });
      router.refresh();
    });
  }

  return (
    <form
      {...props}
      ref={ref}
      aria-busy={pending || undefined}
      onSubmit={(e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        submit(fd);
      }}
    >
      {children}
    </form>
  );
}
