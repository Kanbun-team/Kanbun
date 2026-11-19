import { randomBytes } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { S3Client, type S3Config } from "./s3";

// Where attachment files live. Two backends behind one interface:
//
// - local (default): files on the local volume, next to the SQLite database
//   in an `attachments` folder (so the Docker volume at /data holds both);
//   ATTACHMENTS_DIR overrides the folder.
// - S3-compatible object storage (AWS S3, MinIO, Cloudflare R2, Backblaze B2)
//   when ATTACHMENTS_S3_BUCKET is set, for several instances without a shared
//   folder. Objects are private; downloads still go through the app's
//   authenticated route. Static keys, or the AWS credential chain without them.
//
// Files are named by a random storage key, never by anything the user sent.

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

// ---------------------------------------------------------------------------
// Backend selection
// ---------------------------------------------------------------------------

export type StorageConfig = { kind: "local"; dir: string } | { kind: "s3"; s3: S3Config };

const truthy = (v: string | undefined) => /^(1|true|yes|on)$/i.test(v?.trim() ?? "");

/**
 * The storage backend the environment asks for. Throws when
 * ATTACHMENTS_S3_BUCKET is set but the configuration is incomplete, so a typo
 * never silently falls back to the local disk.
 */
export function attachmentStorageFrom(env: Env, cwd: string): StorageConfig {
  const bucket = env.ATTACHMENTS_S3_BUCKET?.trim();
  if (!bucket) return { kind: "local", dir: attachmentsDirFrom(env, cwd) };

  // Static keys, or neither for the AWS credential chain (AWS_* variables,
  // web identity, ECS or EC2 roles, see aws-credentials.ts).
  const accessKeyId = env.ATTACHMENTS_S3_ACCESS_KEY_ID?.trim() || undefined;
  const secretAccessKey = env.ATTACHMENTS_S3_SECRET_ACCESS_KEY?.trim() || undefined;
  if (!accessKeyId !== !secretAccessKey) {
    const missing = accessKeyId ? "ATTACHMENTS_S3_SECRET_ACCESS_KEY" : "ATTACHMENTS_S3_ACCESS_KEY_ID";
    throw new Error(`ATTACHMENTS_S3_BUCKET is set with only one of the two keys: ${missing} is missing`);
  }
  const sessionToken = env.ATTACHMENTS_S3_SESSION_TOKEN?.trim() || undefined;
  if (sessionToken && !accessKeyId) {
    throw new Error("ATTACHMENTS_S3_SESSION_TOKEN needs ATTACHMENTS_S3_ACCESS_KEY_ID and ATTACHMENTS_S3_SECRET_ACCESS_KEY");
  }

  const endpoint = env.ATTACHMENTS_S3_ENDPOINT?.trim() || undefined;
  if (endpoint) {
    let url: URL;
    try {
      url = new URL(endpoint);
    } catch {
      throw new Error("ATTACHMENTS_S3_ENDPOINT must be a URL, e.g. https://minio.example.com:9000");
    }
    if (url.protocol !== "https:" && url.protocol !== "http:") {
      throw new Error("ATTACHMENTS_S3_ENDPOINT must start with https:// or http://");
    }
  }
  // Path-style addressing is what MinIO and most self-hosted services need;
  // AWS prefers virtual-hosted. Unset, it follows whether an endpoint is given.
  const pathStyle = env.ATTACHMENTS_S3_FORCE_PATH_STYLE?.trim();
  const prefix = (env.ATTACHMENTS_S3_PREFIX ?? "").trim().replace(/^\/+|\/+$/g, "");
  return {
    kind: "s3",
    s3: {
      bucket,
      region: env.ATTACHMENTS_S3_REGION?.trim() || "us-east-1",
      endpoint,
      accessKeyId,
      secretAccessKey,
      sessionToken,
      forcePathStyle: pathStyle ? truthy(pathStyle) : !!endpoint,
      prefix: prefix ? `${prefix}/` : "",
    },
  };
}

// ---------------------------------------------------------------------------
// Backends
// ---------------------------------------------------------------------------

export class AttachmentNotFoundError extends Error {
  constructor(key: string) {
    super(`attachment file not found: ${key}`);
    this.name = "AttachmentNotFoundError";
  }
}

export interface AttachmentStore {
  readonly kind: "local" | "s3";
  save(key: string, bytes: Uint8Array): Promise<void>;
  read(key: string): Promise<Buffer>;
  /** A stream of the file and its size in bytes (null if unknown). Throws AttachmentNotFoundError. */
  open(key: string): Promise<{ stream: ReadableStream<Uint8Array>; size: number | null }>;
  /** Removes a file; a missing file is not an error. */
  remove(key: string): Promise<void>;
}

export function localStore(dir: string): AttachmentStore {
  const file = (key: string) => storagePathIn(dir, key);
  const notFound = (key: string, err: unknown) =>
    (err as NodeJS.ErrnoException).code === "ENOENT" ? new AttachmentNotFoundError(key) : err;
  return {
    kind: "local",
    async save(key, bytes) {
      const target = file(key);
      await mkdir(path.dirname(target), { recursive: true });
      // Write then rename, so a crash never leaves a half-written file under the key.
      const tmp = `${target}.tmp`;
      await writeFile(tmp, bytes, { mode: 0o600 });
      await rename(tmp, target);
    },
    async read(key) {
      try {
        return await readFile(/* turbopackIgnore: true */ file(key));
      } catch (err) {
        throw notFound(key, err);
      }
    },
    async open(key) {
      const target = file(key);
      let info;
      try {
        info = await stat(/* turbopackIgnore: true */ target);
      } catch (err) {
        throw notFound(key, err);
      }
      if (!info.isFile()) throw new AttachmentNotFoundError(key);
      const stream = Readable.toWeb(createReadStream(/* turbopackIgnore: true */ target)) as ReadableStream<Uint8Array>;
      return { stream, size: info.size };
    },
    async remove(key) {
      try {
        await unlink(file(key));
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
      }
    },
  };
}

export function s3Store(config: S3Config, client = new S3Client(config)): AttachmentStore {
  const checked = (key: string) => {
    if (!isStorageKey(key)) throw new Error("invalid storage key");
    return key;
  };
  return {
    kind: "s3",
    async save(key, bytes) {
      await client.put(checked(key), bytes);
    },
    async read(key) {
      const object = await client.get(checked(key));
      if (!object) throw new AttachmentNotFoundError(key);
      return Buffer.from(await new Response(object.body).arrayBuffer());
    },
    async open(key) {
      const object = await client.get(checked(key));
      if (!object) throw new AttachmentNotFoundError(key);
      return { stream: object.body, size: object.size };
    },
    async remove(key) {
      await client.delete(checked(key));
    },
  };
}

// The configuration is only known at runtime; tell Turbopack not to trace the whole project for it.
export const attachmentStorage = () => attachmentStorageFrom(process.env, /* turbopackIgnore: true */ process.cwd());
export const attachmentsDir = () => attachmentsDirFrom(process.env, /* turbopackIgnore: true */ process.cwd());
export const maxAttachmentBytes = () => maxAttachmentBytesFrom(process.env);

const globalForStore = globalThis as unknown as { __kanbunAttachmentStore?: { id: string; store: AttachmentStore } };

/** The configured store, built once per configuration. */
export function attachmentStore(): AttachmentStore {
  const config = attachmentStorage();
  const id = JSON.stringify(config);
  const cached = globalForStore.__kanbunAttachmentStore;
  if (cached?.id === id) return cached.store;
  const store = config.kind === "s3" ? s3Store(config.s3) : localStore(config.dir);
  globalForStore.__kanbunAttachmentStore = { id, store };
  return store;
}

export async function saveAttachmentFile(key: string, bytes: Uint8Array): Promise<void> {
  await attachmentStore().save(key, bytes);
}

export function readAttachmentFile(key: string): Promise<Buffer> {
  return attachmentStore().read(key);
}

/** A stream of a stored file and its size. Throws AttachmentNotFoundError. */
export function openAttachmentFile(key: string): Promise<{ stream: ReadableStream<Uint8Array>; size: number | null }> {
  return attachmentStore().open(key);
}

/** Removes stored files; missing files are ignored and other errors only logged. */
export async function removeAttachmentFiles(keys: string[]): Promise<void> {
  const valid = keys.filter(isStorageKey);
  if (valid.length === 0) return;
  let store: AttachmentStore;
  try {
    store = attachmentStore();
  } catch (err) {
    console.error("[attachments] remove", err);
    return;
  }
  // A few at a time: purging a large board must not open hundreds of requests at once.
  let next = 0;
  const lane = async () => {
    while (next < valid.length) {
      const key = valid[next++];
      try {
        await store.remove(key);
      } catch (err) {
        console.error("[attachments] remove", key, err);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(8, valid.length) }, lane));
}
