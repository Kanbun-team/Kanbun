import type { ReactNode } from "react";

// Shared layout for error and not-found pages: one sentence, one way out.
export default function StatusPage({
  title,
  body,
  children,
}: {
  title: string;
  body: string;
  children: ReactNode;
}) {
  return (
    <div className="mx-auto max-w-md py-24 text-center">
      <h1 className="text-xl font-semibold">{title}</h1>
      <p className="mt-2 text-md text-ink-muted">{body}</p>
      <div className="mt-6 flex justify-center gap-2">{children}</div>
    </div>
  );
}
