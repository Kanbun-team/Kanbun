import { createReadStream } from "node:fs";
import { mkdtemp, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Readable, pipeline } from "node:stream";
import { createGzip } from "node:zlib";
import { prisma } from "@/lib/db-local";
import { APP_VERSION } from "@/lib/version";
import { attachmentsDir } from "@/server/attachment-storage";

// One-click backup for admins: a consistent SQLite snapshot (VACUUM INTO, safe
// while the app keeps writing) plus the attachments folder, streamed as a
// .tar.gz. The archive mirrors the /data volume: kanbun.db and attachments/.
// Restore steps are in README.md ("Backup and restore").

/** True when the database is SQLite (the only engine this backup supports). */
export function isSqliteUrl(url: string | undefined = process.env.DATABASE_URL): boolean {
  return !!url && url.trim().startsWith("file:");
}

const BLOCK = 512;

function octal(value: number, length: number): string {
  return value.toString(8).padStart(length - 1, "0") + "\0";
}

/** A ustar header for a regular file. Names must be ASCII and at most 100 bytes. */
export function tarHeader(name: string, size: number, mtime: Date = new Date()): Buffer {
  if (Buffer.byteLength(name) > 100) throw new Error(`tar: name too long: ${name}`);
  const header = Buffer.alloc(BLOCK, 0);
  header.write(name, 0, 100, "utf8");
  header.write(octal(0o644, 8), 100, 8, "ascii");
  header.write(octal(0, 8), 108, 8, "ascii");
  header.write(octal(0, 8), 116, 8, "ascii");
  header.write(octal(size, 12), 124, 12, "ascii");
  header.write(octal(Math.floor(mtime.getTime() / 1000), 12), 136, 12, "ascii");
  header.write("        ", 148, 8, "ascii"); // checksum is computed with spaces here
  header.write("0", 156, 1, "ascii");
  header.write("ustar\0", 257, 6, "ascii");
  header.write("00", 263, 2, "ascii");
  let sum = 0;
  for (const byte of header) sum += byte;
  header.write(sum.toString(8).padStart(6, "0") + "\0 ", 148, 8, "ascii");
  return header;
}

function padding(size: number): Buffer {
  const rest = size % BLOCK;
  return Buffer.alloc(rest === 0 ? 0 : BLOCK - rest, 0);
}

export interface TarEntry {
  name: string;
  /** A file on disk, streamed, or bytes in memory. */
  file?: string;
  data?: Buffer;
}

/** Streams a tar archive of the given entries. Files that vanished meanwhile are skipped. */
export async function* tarStream(entries: AsyncIterable<TarEntry> | Iterable<TarEntry>): AsyncGenerator<Buffer> {
  for await (const entry of entries) {
    if (entry.data) {
      yield tarHeader(entry.name, entry.data.length);
      yield entry.data;
      yield padding(entry.data.length);
      continue;
    }
    if (!entry.file) continue;
    let info;
    try {
      info = await stat(entry.file);
    } catch {
      continue;
    }
    if (!info.isFile()) continue;
    yield tarHeader(entry.name, info.size, info.mtime);
    let written = 0;
    for await (const chunk of createReadStream(entry.file, { end: Math.max(0, info.size - 1) })) {
      const buf = chunk as Buffer;
      const take = Math.min(buf.length, info.size - written);
      if (take <= 0) break;
      written += take;
      yield take === buf.length ? buf : buf.subarray(0, take);
    }
    // A file that shrank while being read: pad so the header size still holds.
    if (written < info.size) yield Buffer.alloc(info.size - written, 0);
    yield padding(info.size);
  }
  yield Buffer.alloc(BLOCK * 2, 0); // end of archive
}

async function* walk(dir: string, prefix: string): AsyncGenerator<TarEntry> {
  let names: import("node:fs").Dirent[];
  try {
    names = await readdir(dir, { withFileTypes: true });
  } catch {
    return; // no attachments folder yet
  }
  names.sort((a, b) => a.name.localeCompare(b.name));
  for (const d of names) {
    const full = path.join(dir, d.name);
    const name = `${prefix}/${d.name}`;
    if (d.isDirectory()) yield* walk(full, name);
    // Skip half-written uploads (saved as <key>.tmp, then renamed).
    else if (d.isFile() && !d.name.endsWith(".tmp")) yield { name, file: full };
  }
}

export interface Backup {
  stream: ReadableStream<Uint8Array>;
  fileName: string;
}

/** Snapshots the database and returns the archive as a web stream. */
export async function createBackup(): Promise<Backup> {
  const dir = await mkdtemp(path.join(tmpdir(), "kanbun-backup-"));
  const snapshot = path.join(dir, "kanbun.db");
  try {
    // VACUUM INTO writes a consistent, compacted copy without blocking writers
    // for long. The path is ours (mkdtemp), quotes are escaped regardless.
    await prisma.$executeRawUnsafe(`VACUUM INTO '${snapshot.replace(/'/g, "''")}'`);
  } catch (err) {
    await rm(dir, { recursive: true, force: true });
    throw err;
  }
  const createdAt = new Date();
  const manifest = Buffer.from(
    JSON.stringify(
      {
        format: "kanbun-backup",
        version: 1,
        app: { name: "Kanbun", version: APP_VERSION },
        createdAt: createdAt.toISOString(),
        contents: { database: "kanbun.db", attachments: "attachments/" },
      },
      null,
      2
    ) + "\n"
  );

  async function* entries(): AsyncGenerator<TarEntry> {
    yield { name: "backup.json", data: manifest };
    yield { name: "kanbun.db", file: snapshot };
    yield* walk(attachmentsDir(), "attachments");
  }
  async function* archive() {
    try {
      yield* tarStream(entries());
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }

  const gzip = createGzip({ level: 6 });
  // pipeline tears the source down (and so removes the snapshot) when the
  // download fails or is cancelled.
  pipeline(Readable.from(archive()), gzip, (err) => {
    if (err && (err as NodeJS.ErrnoException).code !== "ERR_STREAM_PREMATURE_CLOSE") console.error("[backup]", err);
  });
  const stamp = createdAt.toISOString().slice(0, 16).replace(/[:T]/g, "-");
  return {
    stream: Readable.toWeb(gzip) as ReadableStream<Uint8Array>,
    fileName: `kanbun-backup-${stamp}.tar.gz`,
  };
}
