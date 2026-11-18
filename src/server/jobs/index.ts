// Background jobs for the single Kanbun process. Each feature adds one entry
// to JOBS. Started once from src/instrumentation.ts on the Node.js runtime.

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
