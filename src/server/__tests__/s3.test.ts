import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { S3Client, S3Error, signV4, uriEncode, type S3Config } from "@/server/s3";
import { AttachmentNotFoundError, attachmentStorageFrom, localStore, s3Store } from "@/server/attachment-storage";
import { attachmentsManifest } from "@/server/backup";
import { copyAttachmentsToS3, localAttachmentFiles } from "../../../scripts/attachments-to-s3";

// Signature Version 4 against the published AWS examples, then the client
// against a small in-process S3 that checks every signature.

describe("SigV4 signing", () => {
  it("matches the AWS test suite (get-vanilla)", () => {
    const { signature } = signV4({
      method: "GET",
      url: new URL("https://example.amazonaws.com/"),
      headers: { "X-Amz-Date": "20150830T123600Z" },
      payloadHash: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
      region: "us-east-1",
      service: "service",
      accessKeyId: "AKIDEXAMPLE",
      secretAccessKey: "wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY",
      amzDate: "20150830T123600Z",
    });
    expect(signature).toBe("5fa00fa31553b73ebf1942676e86291e8372ff2a2260956d9b8aae1d763fbf31");
  });

  const s3Example = {
    region: "us-east-1",
    service: "s3",
    accessKeyId: "AKIAIOSFODNN7EXAMPLE",
    secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
    amzDate: "20130524T000000Z",
  };

  it("matches the S3 documentation example: GET Object", () => {
    const { authorization } = signV4({
      ...s3Example,
      method: "GET",
      url: new URL("https://examplebucket.s3.amazonaws.com/test.txt"),
      headers: {
        range: "bytes=0-9",
        "x-amz-content-sha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
        "x-amz-date": "20130524T000000Z",
      },
      payloadHash: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    });
    expect(authorization).toBe(
      "AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7EXAMPLE/20130524/us-east-1/s3/aws4_request, " +
        "SignedHeaders=host;range;x-amz-content-sha256;x-amz-date, " +
        "Signature=f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41"
    );
  });

  it("matches the S3 documentation example: PUT Object", () => {
    const payloadHash = "44ce7dd67c959e0d3524ffac1771dfbba87d2b6b4b4e99e42034a8b803f8b072";
    const { signature } = signV4({
      ...s3Example,
      method: "PUT",
      url: new URL(`https://examplebucket.s3.amazonaws.com/${uriEncode("test$file.text", true)}`),
      headers: {
        date: "Fri, 24 May 2013 00:00:00 GMT",
        "x-amz-date": "20130524T000000Z",
        "x-amz-storage-class": "REDUCED_REDUNDANCY",
        "x-amz-content-sha256": payloadHash,
      },
      payloadHash,
    });
    expect(signature).toBe("98ad721746da40c64f1a55b78f14c238d841ea1380cd77a1b5971af0ece108bd");
  });

  it("matches the S3 documentation example: GET with query parameters", () => {
    const { signature } = signV4({
      ...s3Example,
      method: "GET",
      url: new URL("https://examplebucket.s3.amazonaws.com/?max-keys=2&prefix=J"),
      headers: {
        "x-amz-content-sha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
        "x-amz-date": "20130524T000000Z",
      },
      payloadHash: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    });
    expect(signature).toBe("34b48302e7b5fa45bde8084f4b7868a86f0a534bc59db6670ed5711ef69dc6f7");
  });

  it("encodes like S3 expects", () => {
    expect(uriEncode("a b/c$d~e", true)).toBe("a%20b/c%24d~e");
    expect(uriEncode("a/b", false)).toBe("a%2Fb");
    expect(uriEncode("ż", true)).toBe("%C5%BC");
  });
});

// ---------------------------------------------------------------------------
// A fake S3: path-style, objects in a Map, every signature verified.
// ---------------------------------------------------------------------------

const SECRET = "fake-secret-key";
let server: Server;
let endpoint: string;
const objects = new Map<string, Buffer>();
const requests: { method: string; path: string }[] = [];

function readBody(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

const errorXml = (code: string) =>
  `<?xml version="1.0" encoding="UTF-8"?><Error><Code>${code}</Code><Message>${code}</Message></Error>`;

const AUTH_RE =
  /^AWS4-HMAC-SHA256 Credential=([^/]+)\/(\d{8})\/([^/]+)\/s3\/aws4_request, SignedHeaders=([^,]+), Signature=([a-f0-9]{64})$/;

function validSignature(req: IncomingMessage, url: URL, body: Buffer): boolean {
  const m = AUTH_RE.exec(String(req.headers.authorization ?? ""));
  const payloadHash = String(req.headers["x-amz-content-sha256"] ?? "");
  if (!m || payloadHash !== createHash("sha256").update(body).digest("hex")) return false;
  const headers: Record<string, string> = {};
  for (const name of m[4].split(";")) if (name !== "host") headers[name] = String(req.headers[name]);
  const expected = signV4({
    method: req.method!,
    url,
    headers,
    payloadHash,
    region: m[3],
    service: "s3",
    accessKeyId: m[1],
    secretAccessKey: SECRET,
    amzDate: String(req.headers["x-amz-date"]),
  });
  return expected.signature === m[5];
}

beforeAll(async () => {
  server = createServer(async (req, res) => {
    const body = await readBody(req);
    const url = new URL(`http://${req.headers.host}${req.url}`);
    requests.push({ method: req.method!, path: url.pathname });
    if (!validSignature(req, url, body)) {
      res.writeHead(403, { "content-type": "application/xml" }).end(errorXml("SignatureDoesNotMatch"));
      return;
    }
    const key = decodeURIComponent(url.pathname);
    if (req.method === "PUT") {
      objects.set(key, body);
      res.writeHead(200, { etag: '"x"' }).end();
    } else if (req.method === "GET" || req.method === "HEAD") {
      const obj = objects.get(key);
      if (!obj) {
        res.writeHead(404, { "content-type": "application/xml" }).end(req.method === "GET" ? errorXml("NoSuchKey") : undefined);
        return;
      }
      res.writeHead(200, { "content-length": obj.length, "content-type": "application/octet-stream" });
      res.end(req.method === "GET" ? obj : undefined);
    } else if (req.method === "DELETE") {
      objects.delete(key);
      res.writeHead(204).end();
    } else {
      res.writeHead(405).end();
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  endpoint = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(() => new Promise((resolve) => server.close(resolve)));

beforeEach(() => {
  objects.clear();
  requests.length = 0;
});

const config = (over: Partial<S3Config> = {}): S3Config => ({
  bucket: "kanbun-files",
  region: "eu-central-1",
  endpoint,
  accessKeyId: "AKIDTEST",
  secretAccessKey: SECRET,
  forcePathStyle: true,
  prefix: "prod/",
  ...over,
});

const KEY = "0123456789abcdef0123456789abcdef";

describe("S3 attachment store against a fake S3", () => {
  it("saves, streams, reads and removes a file under the prefix", async () => {
    const store = s3Store(config());
    const bytes = new TextEncoder().encode("hello attachments");
    await store.save(KEY, bytes);
    expect([...objects.keys()]).toEqual([`/kanbun-files/prod/${KEY}`]);

    const opened = await store.open(KEY);
    expect(opened.size).toBe(bytes.length);
    expect(await new Response(opened.stream).text()).toBe("hello attachments");
    expect((await store.read(KEY)).toString()).toBe("hello attachments");

    await store.remove(KEY);
    expect(objects.size).toBe(0);
    await expect(store.open(KEY)).rejects.toBeInstanceOf(AttachmentNotFoundError);
    await expect(store.read(KEY)).rejects.toBeInstanceOf(AttachmentNotFoundError);
    // Removing a missing file is fine.
    await store.remove(KEY);
  });

  it("streams a larger binary file intact", async () => {
    const store = s3Store(config({ prefix: "" }));
    const bytes = new Uint8Array(3 * 1024 * 1024).map((_, i) => (i * 31) % 256);
    await store.save(KEY, bytes);
    const opened = await store.open(KEY);
    const back = Buffer.from(await new Response(opened.stream).arrayBuffer());
    expect(back.length).toBe(bytes.length);
    expect(Buffer.compare(back, Buffer.from(bytes))).toBe(0);
  });

  it("reports S3 errors with their code", async () => {
    const store = s3Store(config({ secretAccessKey: "wrong" }));
    const err = await store.save(KEY, new Uint8Array([1])).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(S3Error);
    expect(err).toMatchObject({ status: 403, code: "SignatureDoesNotMatch" });
  });

  it("refuses anything that is not a storage key", async () => {
    const store = s3Store(config());
    await expect(store.save("../etc/passwd", new Uint8Array([1]))).rejects.toThrow(/invalid storage key/);
    expect(requests).toHaveLength(0);
  });

  it("HEAD gives the size, or null for a missing object", async () => {
    const client = new S3Client(config());
    expect(await client.head(KEY)).toBeNull();
    await client.put(KEY, new Uint8Array([1, 2, 3]));
    expect(await client.head(KEY)).toEqual({ size: 3 });
  });
});

describe("object URLs", () => {
  it("uses virtual-hosted AWS URLs by default", () => {
    const c = new S3Client(config({ endpoint: undefined, forcePathStyle: false }));
    expect(c.objectUrl(KEY).toString()).toBe(`https://kanbun-files.s3.eu-central-1.amazonaws.com/prod/${KEY}`);
  });

  it("puts the bucket in the path with path-style addressing", () => {
    const c = new S3Client(config({ endpoint: "https://minio.example.com:9000/", prefix: "a b/" }));
    expect(c.objectUrl(KEY).toString()).toBe(`https://minio.example.com:9000/kanbun-files/a%20b/${KEY}`);
  });

  it("puts the bucket in the host name for a custom endpoint without path style", () => {
    const c = new S3Client(config({ endpoint: "https://acct.r2.cloudflarestorage.com", forcePathStyle: false, prefix: "" }));
    expect(c.objectUrl(KEY).toString()).toBe(`https://kanbun-files.acct.r2.cloudflarestorage.com/${KEY}`);
  });
});

describe("storage selection", () => {
  const s3Env = {
    ATTACHMENTS_S3_BUCKET: "files",
    ATTACHMENTS_S3_ACCESS_KEY_ID: "id",
    ATTACHMENTS_S3_SECRET_ACCESS_KEY: "secret",
  };

  it("is the local folder without a bucket", () => {
    expect(attachmentStorageFrom({ DATABASE_URL: "file:/data/kanbun.db" }, "/app")).toEqual({
      kind: "local",
      dir: path.join("/data", "attachments"),
    });
    expect(attachmentStorageFrom({ ATTACHMENTS_S3_BUCKET: "  ", ATTACHMENTS_DIR: "/srv/files" }, "/app")).toEqual({
      kind: "local",
      dir: "/srv/files",
    });
  });

  it("is S3 with a bucket, with AWS defaults", () => {
    expect(attachmentStorageFrom(s3Env, "/app")).toEqual({
      kind: "s3",
      s3: {
        bucket: "files",
        region: "us-east-1",
        endpoint: undefined,
        accessKeyId: "id",
        secretAccessKey: "secret",
        forcePathStyle: false,
        prefix: "",
      },
    });
  });

  it("defaults to path style with an endpoint, unless told otherwise, and normalises the prefix", () => {
    const withEndpoint = {
      ...s3Env,
      ATTACHMENTS_S3_ENDPOINT: "http://minio:9000",
      ATTACHMENTS_S3_PREFIX: "/kanbun/attachments/",
    };
    const a = attachmentStorageFrom(withEndpoint, "/app");
    expect(a.kind === "s3" && a.s3).toMatchObject({
      forcePathStyle: true,
      prefix: "kanbun/attachments/",
      endpoint: "http://minio:9000",
    });
    const b = attachmentStorageFrom({ ...withEndpoint, ATTACHMENTS_S3_FORCE_PATH_STYLE: "false" }, "/app");
    expect(b.kind === "s3" && b.s3.forcePathStyle).toBe(false);
    const c = attachmentStorageFrom({ ...s3Env, ATTACHMENTS_S3_FORCE_PATH_STYLE: "1", ATTACHMENTS_S3_REGION: "auto" }, "/app");
    expect(c.kind === "s3" && c.s3).toMatchObject({ forcePathStyle: true, region: "auto" });
  });

  it("refuses an incomplete S3 configuration instead of falling back to disk", () => {
    expect(() => attachmentStorageFrom({ ATTACHMENTS_S3_BUCKET: "files" }, "/app")).toThrow(
      /ATTACHMENTS_S3_ACCESS_KEY_ID and ATTACHMENTS_S3_SECRET_ACCESS_KEY/
    );
    expect(() => attachmentStorageFrom({ ...s3Env, ATTACHMENTS_S3_ENDPOINT: "minio:9000" }, "/app")).toThrow(/ENDPOINT/);
    expect(() => attachmentStorageFrom({ ...s3Env, ATTACHMENTS_S3_ENDPOINT: "ftp://minio" }, "/app")).toThrow(/ENDPOINT/);
  });

  it("notes in the backup manifest that S3 files are not included", () => {
    const storage = attachmentStorageFrom(s3Env, "/app");
    expect(attachmentsManifest(storage)).toMatchObject({
      attachments: null,
      attachmentStorage: { type: "s3", bucket: "files", included: false },
    });
    expect(attachmentsManifest({ kind: "local", dir: "/x" })).toEqual({
      attachments: "attachments/",
      attachmentStorage: { type: "local" },
    });
  });
});

describe("local attachment store", () => {
  it("saves, streams and removes files on disk", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "kanbun-store-"));
    try {
      const store = localStore(dir);
      await store.save(KEY, new TextEncoder().encode("on disk"));
      const opened = await store.open(KEY);
      expect(opened.size).toBe(7);
      expect(await new Response(opened.stream).text()).toBe("on disk");
      await store.remove(KEY);
      await expect(store.open(KEY)).rejects.toBeInstanceOf(AttachmentNotFoundError);
      await expect(store.read(KEY)).rejects.toBeInstanceOf(AttachmentNotFoundError);
      await store.remove(KEY);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("scripts/attachments-to-s3", () => {
  it("copies local files once, skips what is there, ignores the rest", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "kanbun-to-s3-"));
    try {
      const local = localStore(dir);
      const other = "fedcba9876543210fedcba9876543210";
      await local.save(KEY, new TextEncoder().encode("one"));
      await local.save(other, new TextEncoder().encode("two"));
      await writeFile(path.join(dir, "01", `${KEY}.tmp`), "half");
      await writeFile(path.join(dir, "README"), "not an attachment");
      const client = new S3Client(config());

      const dry = await copyAttachmentsToS3({ dir, client, dryRun: true });
      expect(dry).toEqual({ found: 2, present: 0, copied: 2, failed: 0, ignored: 2 });
      expect(objects.size).toBe(0);

      expect(await copyAttachmentsToS3({ dir, client, dryRun: false })).toMatchObject({ copied: 2, present: 0 });
      expect((await s3Store(config()).read(other)).toString()).toBe("two");

      expect(await copyAttachmentsToS3({ dir, client, dryRun: false })).toMatchObject({ copied: 0, present: 2 });

      const failing = new S3Client(config({ secretAccessKey: "wrong" }));
      const lines: string[] = [];
      expect(await copyAttachmentsToS3({ dir, client: failing, dryRun: false, log: (l) => lines.push(l) })).toMatchObject({
        failed: 2,
      });
      expect(lines[0]).toMatch(/HTTP 403/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("finds nothing in a missing folder", async () => {
    expect(await localAttachmentFiles(path.join(tmpdir(), "kanbun-missing-folder-x"))).toEqual({ files: [], ignored: 0 });
  });
});
