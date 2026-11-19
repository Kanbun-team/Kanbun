// Copies the attachment files on the local disk into the S3 bucket, for a
// move from local attachment storage to S3. See README.md ("Attachments in
// S3") for the procedure.
//
//   npm run attachments:to-s3 -- [--dry-run] [--from /data/attachments]
//
// The bucket comes from the ATTACHMENTS_S3_* variables, exactly as the app
// reads them. --from defaults to the local folder the app would use without
// S3 (ATTACHMENTS_DIR, or `attachments` next to the SQLite database).
//
// Objects that already exist in the bucket with the same size are skipped,
// so the script can be run again after an interruption. Local files are never
// deleted: remove the folder yourself once Kanbun runs on S3 and downloads
// work. --dry-run only checks the bucket and prints what it would copy.

import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { attachmentStorageFrom, attachmentsDirFrom, isFileKey } from "../src/server/attachment-storage";
import { S3Client } from "../src/server/s3";

export interface CopyCounts {
  /** Attachment files found in the folder. */
  found: number;
  /** Already in the bucket with the same size. */
  present: number;
  /** Copied (or, with --dry-run, would be copied). */
  copied: number;
  failed: number;
  /** Files in the folder that are not attachment files, left alone. */
  ignored: number;
}

/** Storage keys and paths of the attachment files (and thumbnails) in `dir` (`<dir>/<ab>/<key>`). */
export async function localAttachmentFiles(dir: string): Promise<{ files: { key: string; file: string }[]; ignored: number }> {
  const files: { key: string; file: string }[] = [];
  let ignored = 0;
  let shards: import("node:fs").Dirent[];
  try {
    shards = await readdir(dir, { withFileTypes: true });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return { files, ignored };
    throw err;
  }
  for (const shard of shards.sort((a, b) => a.name.localeCompare(b.name))) {
    if (!shard.isDirectory()) {
      ignored++;
      continue;
    }
    for (const entry of await readdir(path.join(dir, shard.name), { withFileTypes: true })) {
      // Half-written uploads end in .tmp; only finished files under their own shard count.
      if (entry.isFile() && isFileKey(entry.name) && entry.name.startsWith(shard.name)) {
        files.push({ key: entry.name, file: path.join(dir, shard.name, entry.name) });
      } else {
        ignored++;
      }
    }
  }
  return { files, ignored };
}

export async function copyAttachmentsToS3(opts: {
  dir: string;
  client: S3Client;
  dryRun: boolean;
  concurrency?: number;
  log?: (line: string) => void;
}): Promise<CopyCounts> {
  const log = opts.log ?? (() => {});
  const { files, ignored } = await localAttachmentFiles(opts.dir);
  const counts: CopyCounts = { found: files.length, present: 0, copied: 0, failed: 0, ignored };
  let next = 0;
  const lane = async () => {
    while (next < files.length) {
      const { key, file } = files[next++];
      try {
        const size = (await stat(file)).size;
        const existing = await opts.client.head(key);
        if (existing && existing.size === size) {
          counts.present++;
          continue;
        }
        if (!opts.dryRun) await opts.client.put(key, await readFile(file));
        counts.copied++;
      } catch (err) {
        counts.failed++;
        log(`failed ${key}: ${(err as Error).message}`);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, opts.concurrency ?? 4) }, lane));
  return counts;
}

function parseArgs(argv: string[]) {
  const args = { dryRun: false, from: "" };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--dry-run") args.dryRun = true;
    else if (a === "--from") args.from = argv[++i] ?? "";
    else throw new Error(`unknown argument: ${a}`);
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const storage = attachmentStorageFrom(process.env, process.cwd());
  if (storage.kind !== "s3") {
    throw new Error("ATTACHMENTS_S3_BUCKET is not set: configure the ATTACHMENTS_S3_* variables first");
  }
  const dir = args.from ? path.resolve(args.from) : attachmentsDirFrom(process.env, process.cwd());
  const target = `s3://${storage.s3.bucket}/${storage.s3.prefix}`;
  console.log(`${args.dryRun ? "Checking" : "Copying"} ${dir} -> ${target}`);
  const counts = await copyAttachmentsToS3({
    dir,
    client: new S3Client(storage.s3),
    dryRun: args.dryRun,
    log: (line) => console.error(line),
  });
  console.log(`files found:           ${counts.found}`);
  console.log(`already in the bucket: ${counts.present}`);
  console.log(`${args.dryRun ? "would copy:           " : "copied:               "} ${counts.copied}`);
  console.log(`failed:                ${counts.failed}`);
  if (counts.ignored) console.log(`ignored (not attachment files): ${counts.ignored}`);
  if (counts.failed) process.exitCode = 1;
  else if (!args.dryRun) console.log("Done. Start Kanbun with the ATTACHMENTS_S3_* variables, check a few downloads, then remove the local folder.");
}

if (process.argv[1] && /attachments-to-s3\.ts$/.test(process.argv[1])) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
