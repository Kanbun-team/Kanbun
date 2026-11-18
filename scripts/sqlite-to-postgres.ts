// Copies every row of a Kanbun SQLite database into an empty, migrated
// PostgreSQL database. See docs/SCALING.md for the full procedure.
//
//   npm run db:sqlite-to-postgres -- --from file:/data/kanbun.db \
//     --to postgresql://kanbun:secret@db:5432/kanbun [--dry-run] [--batch 500]
//
// --to defaults to DATABASE_URL when that is a PostgreSQL URL. Prepare the
// target first with `DATABASE_URL=<target> node scripts/db.mjs deploy`.
//
// Tables are copied in foreign-key order (parents first), in one transaction:
// either everything is copied or nothing is. Afterwards the row counts of both
// databases are compared. The search index fills itself (triggers). The target
// must be empty, so the script can never mix two installations.
// --dry-run only prints the row counts that would be copied.

import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { isAbsolute, join } from "node:path";
import { Prisma, PrismaClient } from "@prisma/client";

type Delegate = {
  count: () => Promise<number>;
  findMany: (args: { skip: number; take: number; orderBy: Record<string, "asc">[] }) => Promise<Record<string, unknown>[]>;
  createMany: (args: { data: Record<string, unknown>[] }) => Promise<{ count: number }>;
};
type Model = (typeof Prisma.dmmf.datamodel.models)[number];

export interface CopyPlanEntry {
  model: string;
  delegate: string;
  orderBy: string[];
  selfRelation: { from: string; to: string } | null;
}

/** Models in an order where every model comes after the models it references. */
export function copyPlan(models: readonly Model[]): CopyPlanEntry[] {
  const byName = new Map(models.map((m) => [m.name, m]));
  const deps = new Map<string, Set<string>>();
  for (const m of models) {
    const set = new Set<string>();
    for (const f of m.fields) {
      if (f.kind === "object" && f.relationFromFields?.length && f.type !== m.name) set.add(f.type);
    }
    deps.set(m.name, set);
  }
  const order: string[] = [];
  const state = new Map<string, "visiting" | "done">();
  const visit = (name: string, path: string[]) => {
    if (state.get(name) === "done") return;
    if (state.get(name) === "visiting") throw new Error(`foreign keys form a cycle: ${[...path, name].join(" -> ")}`);
    state.set(name, "visiting");
    for (const dep of [...(deps.get(name) ?? [])].sort()) visit(dep, [...path, name]);
    state.set(name, "done");
    order.push(name);
  };
  for (const m of [...models].sort((a, b) => a.name.localeCompare(b.name))) visit(m.name, []);

  return order.map((name) => {
    const m = byName.get(name)!;
    const id = m.fields.filter((f) => f.isId).map((f) => f.name);
    let orderBy: string[] = id.length > 0 ? id : [...(m.primaryKey?.fields ?? [])];
    if (orderBy.length === 0) {
      orderBy = [...(m.uniqueFields[0] ?? m.fields.filter((f) => f.isUnique).map((f) => f.name))];
    }
    if (orderBy.length === 0) throw new Error(`model ${name} has no primary key to page through`);
    const self = m.fields.find((f) => f.kind === "object" && f.type === m.name && f.relationFromFields?.length);
    if (self && (self.relationFromFields!.length !== 1 || self.relationToFields?.length !== 1)) {
      throw new Error(`model ${name}: only single-column self relations are supported`);
    }
    return {
      model: name,
      delegate: name.charAt(0).toLowerCase() + name.slice(1),
      orderBy: [...orderBy],
      selfRelation: self ? { from: self.relationFromFields![0], to: self.relationToFields![0] } : null,
    };
  });
}

/** Orders rows of a self-referencing table so every parent precedes its
 * children (rows whose parent is missing keep their place at the front). */
export function parentsFirst(rows: Record<string, unknown>[], from: string, to: string): Record<string, unknown>[] {
  const ids = new Set(rows.map((r) => r[to]));
  const placed = new Set<unknown>();
  const out: Record<string, unknown>[] = [];
  let pending = rows;
  while (pending.length > 0) {
    const next: Record<string, unknown>[] = [];
    for (const row of pending) {
      const parent = row[from];
      if (parent == null || !ids.has(parent) || placed.has(parent)) {
        out.push(row);
        placed.add(row[to]);
      } else {
        next.push(row);
      }
    }
    if (next.length === pending.length) throw new Error("self relation has a cycle");
    pending = next;
  }
  return out;
}

function parseArgs(argv: string[]) {
  const args = { from: "", to: "", dryRun: false, batch: 500 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--dry-run") args.dryRun = true;
    else if (a === "--from") args.from = argv[++i] ?? "";
    else if (a === "--to") args.to = argv[++i] ?? "";
    else if (a === "--batch") args.batch = Number(argv[++i]);
    else if (a === "--help" || a === "-h") {
      console.log("usage: sqlite-to-postgres --from file:<path> [--to postgresql://...] [--dry-run] [--batch 500]");
      process.exit(0);
    } else throw new Error(`unknown argument ${a}`);
  }
  if (!args.to && /^postgres(ql)?:\/\//.test(process.env.DATABASE_URL ?? "")) args.to = process.env.DATABASE_URL!;
  if (!args.from.startsWith("file:")) throw new Error("--from must be a SQLite URL, e.g. file:/data/kanbun.db");
  if (!/^postgres(ql)?:\/\//.test(args.to)) throw new Error("--to must be a PostgreSQL URL (or set DATABASE_URL to one)");
  if (!Number.isInteger(args.batch) || args.batch < 1 || args.batch > 10_000) throw new Error("--batch must be 1..10000");
  // Like DATABASE_URL, a relative SQLite path is relative to prisma/.
  const file = args.from.slice("file:".length).split("?")[0];
  const path = isAbsolute(file) ? file : join(__dirname, "..", "prisma", file);
  if (!existsSync(path)) throw new Error(`no SQLite database at ${path} (relative paths start in prisma/, as in DATABASE_URL)`);
  return args;
}

function redact(url: string): string {
  try {
    const u = new URL(url);
    if (u.password) u.password = "***";
    return u.toString();
  } catch {
    return url;
  }
}

async function counts(client: object, plan: CopyPlanEntry[]): Promise<Map<string, number>> {
  const result = new Map<string, number>();
  for (const entry of plan) {
    result.set(entry.model, await (client as Record<string, Delegate>)[entry.delegate].count());
  }
  return result;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const plan = copyPlan(Prisma.dmmf.datamodel.models);
  const source = new PrismaClient({ datasources: { db: { url: args.from } } });
  const pg = createRequire(__filename)(".prisma/client-postgres") as { PrismaClient: typeof PrismaClient };
  const target = new pg.PrismaClient({ datasources: { db: { url: args.to } } });

  try {
    console.log(`From ${args.from}\nTo   ${redact(args.to)}\n`);
    const sourceCounts = await counts(source, plan);
    let targetCounts: Map<string, number>;
    try {
      targetCounts = await counts(target, plan);
    } catch (err) {
      throw new Error(
        `cannot read the target tables. Migrate it first: DATABASE_URL=<target> node scripts/db.mjs deploy\n${err instanceof Error ? err.message : err}`,
      );
    }
    const width = Math.max(...plan.map((p) => p.model.length));
    console.log(`${"table".padEnd(width)}  source  target`);
    for (const { model } of plan) {
      console.log(`${model.padEnd(width)}  ${String(sourceCounts.get(model)).padStart(6)}  ${String(targetCounts.get(model)).padStart(6)}`);
    }
    const total = [...sourceCounts.values()].reduce((a, b) => a + b, 0);
    const nonEmpty = plan.filter((p) => (targetCounts.get(p.model) ?? 0) > 0).map((p) => p.model);
    if (nonEmpty.length > 0) throw new Error(`the target is not empty (${nonEmpty.join(", ")}): use a fresh database`);
    if (args.dryRun) {
      console.log(`\nDry run: ${total} rows in ${plan.length} tables would be copied. Nothing was written.`);
      return;
    }

    console.log(`\nCopying ${total} rows...`);
    await target.$transaction(
      async (tx) => {
        for (const entry of plan) {
          const from = (source as unknown as Record<string, Delegate>)[entry.delegate];
          const to = (tx as unknown as Record<string, Delegate>)[entry.delegate];
          const orderBy = entry.orderBy.map((f) => ({ [f]: "asc" as const }));
          if (entry.selfRelation) {
            // Small tables in practice: load all rows, insert parents first.
            const all: Record<string, unknown>[] = [];
            for (let skip = 0; ; skip += args.batch) {
              const rows = await from.findMany({ skip, take: args.batch, orderBy });
              all.push(...rows);
              if (rows.length < args.batch) break;
            }
            const ordered = parentsFirst(all, entry.selfRelation.from, entry.selfRelation.to);
            for (let i = 0; i < ordered.length; i += args.batch) {
              await to.createMany({ data: ordered.slice(i, i + args.batch) });
            }
          } else {
            for (let skip = 0; ; skip += args.batch) {
              const rows = await from.findMany({ skip, take: args.batch, orderBy });
              if (rows.length > 0) await to.createMany({ data: rows });
              if (rows.length < args.batch) break;
            }
          }
          console.log(`  ${entry.model}: ${sourceCounts.get(entry.model)}`);
        }
      },
      { timeout: 60 * 60 * 1000, maxWait: 60_000 },
    );

    const after = await counts(target, plan);
    const mismatched = plan.filter((p) => after.get(p.model) !== sourceCounts.get(p.model));
    if (mismatched.length > 0) {
      throw new Error(
        `row counts differ after the copy: ${mismatched.map((p) => `${p.model} ${sourceCounts.get(p.model)} -> ${after.get(p.model)}`).join(", ")}`,
      );
    }
    console.log(`\nDone: ${total} rows copied, row counts match.`);
    console.log("Copy the attachments directory (ATTACHMENTS_DIR) to the shared volume as well.");
  } finally {
    await source.$disconnect();
    await target.$disconnect();
  }
}

if (process.argv[1] && /sqlite-to-postgres\.ts$/.test(process.argv[1])) {
  main().catch((err) => {
    console.error(`\n${err instanceof Error ? err.message : err}`);
    process.exit(1);
  });
}
