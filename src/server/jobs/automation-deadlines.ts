// Job: "when a card's deadline passes" automation rules. The rules run in
// runDeadlineRules (src/server/automations.ts); this wrapper sends the live
// board updates, webhooks and notifications once the changes are committed.

import { publishBoard } from "@/lib/realtime";
import { publishRuleRuns, runDeadlineRules } from "@/server/automations";

export async function runDeadlineJob(now: Date = new Date()): Promise<number> {
  const { runs } = await runDeadlineRules(now);
  const changed = runs.filter((r) => r.changes.length > 0);
  await publishRuleRuns(changed);
  for (const boardId of new Set(changed.map((r) => r.boardId))) publishBoard(boardId);
  return changed.length;
}
