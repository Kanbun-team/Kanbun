import { unstable_rethrow } from "next/navigation";
import { ZodError } from "zod";
import { Prisma } from "@prisma/client";
import { ActionError, type ActionResult, type ErrorCode } from "@/lib/action-result";

// Runs an action body and turns every failure into a typed result. Navigation
// signals (redirect, notFound) are rethrown so Next.js can handle them.
export async function safeAction<T>(fn: () => Promise<T>): Promise<ActionResult<T>> {
  try {
    return { ok: true, data: await fn() };
  } catch (err) {
    unstable_rethrow(err);
    return { ok: false, error: toErrorCode(err) };
  }
}

function toErrorCode(err: unknown): ErrorCode {
  if (err instanceof ActionError) return err.code;
  if (err instanceof ZodError) return "invalid";
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === "P2025") return "notFound";
    if (err.code === "P2002") return "invalid";
  }
  console.error("[action]", err);
  return "unknown";
}
