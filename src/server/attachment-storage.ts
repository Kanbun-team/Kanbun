import { randomBytes } from "node:crypto";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

// Attachment files on the local volume. By default they sit next to the
// SQLite database in an `attachments` folder (so the Docker volume at /data
// holds both); ATTACHMENTS_DIR overrides it. Files are named by a random
// storage key, never by anything the user sent.

const KEY_RE = /^[a-f0-9]{32}$/;

type Env = Record<string, string | undefined>;

/**
 * Directory for attachment files. A relative `file:` DATABASE_URL is resolved
 * against the prisma folder, the way Prisma resolves it.
 */
export function attachmentsDirFrom(env: Env, cwd: string): string {
  if (env.ATTACHMENTS_DIR?.trim()) return path.resolve(cwd, env.ATTACHMENTS_DIR.trim());
  const url = env.DATABASE_URL?.trim() ?? "";
  const file = url.startsWith("file:") ? url.slice("file:".length).split("?")[0] : "";
  if (!file) return path.resolve(cwd, "prisma", "attachments");
  const dbPath = path.isAbsolute(file) ? file : path.resolve(cwd, "prisma", file);
  return path.join(path.dirname(dbPath), "attachments");
}

/** Upload size limit in bytes from ATTACHMENT_MAX_MB (default 10). */
export function maxAttachmentBytesFrom(env: Env): number {
  const mb = Number(env.ATTACHMENT_MAX_MB);
  return Math.round((Number.isFinite(mb) && mb > 0 ? mb : 10) * 1024 * 1024);
}

export function isStorageKey(key: string): boolean {
  return KEY_RE.test(key);
}

export function newStorageKey(): string {
  return randomBytes(16).toString("hex");
}

/** Absolute path of a stored file. Throws for anything that is not a storage key. */
export function storagePathIn(dir: string, key: string): string {
  if (!isStorageKey(key)) throw new Error("invalid storage key");
  return path.join(dir, key.slice(0, 2), key);
}

export const attachmentsDir = () => attachmentsDirFrom(process.env, process.cwd());
export const maxAttachmentBytes = () => maxAttachmentBytesFrom(process.env);
const storagePath = (key: string) => storagePathIn(attachmentsDir(), key);

export async function saveAttachmentFile(key: string, bytes: Uint8Array): Promise<void> {
  const target = storagePath(key);
  await mkdir(path.dirname(target), { recursive: true });
  // Write then rename, so a crash never leaves a half-written file under the key.
  const tmp = `${target}.tmp`;
  await writeFile(tmp, bytes, { mode: 0o600 });
  await rename(tmp, target);
}

export function readAttachmentFile(key: string): Promise<Buffer> {
  return readFile(storagePath(key));
}

/** Removes stored files; missing files are ignored. */
export async function removeAttachmentFiles(keys: string[]): Promise<void> {
  await Promise.all(
    keys.filter(isStorageKey).map(async (key) => {
      try {
        await unlink(storagePath(key));
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== "ENOENT") console.error("[attachments] remove", key, err);
      }
    })
  );
}
