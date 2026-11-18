// Background jobs. Each feature adds one entry to JOBS. Started once per
// process from src/instrumentation.ts on the Node.js runtime. With several
// instances (REDIS_URL set) each run is claimed through a Redis lock first, so
// only one instance runs it (see ./lock.ts).

import { claimJobRun } from "./lock";
import { runRecurringCards } from "./recurring";

export interface Job {
  name: string;
  /** How often to run, in milliseconds. */
  everyMs: number;
  run: () => Promise<void>;
}

const JOBS: Job[] = [
  {
    name: "dueSoon",
    everyMs: 15 * 60 * 1000,
    run: async () => {
      const { runDueSoon } = await import("./due-soon");
      await runDueSoon();
    },
  },
  {
    name: "digest",
    everyMs: 60 * 60 * 1000,
    run: async () => {
      const { runDigest } = await import("./digest");
      await runDigest();
    },
  },
  {
    // Webhook outbox: deliveries left pending by a restart, a crash or
    // another instance. New deliveries and retries are sent at once by the
    // process that queued them; this is the safety net.
    name: "webhooks",
    everyMs: 15_000,
    run: async () => {
      const { runWebhookQueue } = await import("../webhooks");
      await runWebhookQueue();
    },
  },
  // Recurring cards: due schedules create their card within a minute.
  { name: "recurring-cards", everyMs: 60_000, run: async () => void (await runRecurringCards()) },
  {
    // Audit log retention (AUDIT_RETENTION_DAYS, default 365 days).
    name: "audit-purge",
    everyMs: 6 * 60 * 60 * 1000,
    run: async () => {
      const { runAuditPurge } = await import("./audit-purge");
      await runAuditPurge();
    },
  },
  {
    // Trash older than 30 days, with the card history of what it held. Also
    // done on every delete; this covers instances where nobody deletes.
    name: "trash-purge",
    everyMs: 6 * 60 * 60 * 1000,
    run: async () => {
      const { runTrashPurge } = await import("../trash");
      await runTrashPurge();
    },
  },
];

const globalForJobs = globalThis as unknown as { __kanbunJobsStarted?: boolean };

export function startJobs(): void {
  if (globalForJobs.__kanbunJobsStarted || process.env.KANBUN_DISABLE_JOBS === "1") return;
  globalForJobs.__kanbunJobsStarted = true;
  for (const job of JOBS) {
    let running = false;
    const tick = async () => {
      if (running) return;
      running = true;
      try {
        if (!(await claimJobRun(job.name, job.everyMs))) return;
        await job.run();
      } catch (err) {
        console.error(`[jobs] ${job.name} failed`, err);
      } finally {
        running = false;
      }
    };
    // First run shortly after boot, then on the interval.
    setTimeout(tick, 5_000).unref?.();
    setInterval(tick, job.everyMs).unref?.();
  }
}
