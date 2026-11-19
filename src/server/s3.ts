import { createHash, createHmac } from "node:crypto";
import { defaultCredentialChain, staticCredentials, type CredentialProvider } from "./aws-credentials";

// A minimal client for S3-compatible object storage (AWS S3, MinIO,
// Cloudflare R2, Backblaze B2): PUT, GET, HEAD and DELETE of single objects,
// signed with AWS Signature Version 4. That is all attachments need, and it
// keeps the AWS SDK and its dependency tree out of the app. Requests go
// through the global fetch. Credentials are static keys from the config or,
// without them, the AWS default chain (see aws-credentials.ts).

export interface S3Config {
  bucket: string;
  region: string;
  /** Base URL for S3-compatible services; unset for AWS. */
  endpoint?: string;
  /** Static keys; both unset means the AWS credential chain. */
  accessKeyId?: string;
  secretAccessKey?: string;
  /** With temporary static keys. */
  sessionToken?: string;
  /** `https://host/bucket/key` instead of `https://bucket.host/key`. */
  forcePathStyle: boolean;
  /** Object key prefix, empty or ending in `/`. */
  prefix: string;
}

const EMPTY_SHA256 = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
const REQUEST_TIMEOUT_MS = 30_000;

const sha256Hex = (data: string | Uint8Array) => createHash("sha256").update(data).digest("hex");
const hmac = (key: string | Buffer, data: string) => createHmac("sha256", key).update(data).digest();

/** RFC 3986 encoding as SigV4 wants it: everything but A-Z a-z 0-9 - _ . ~ (and `/` in paths). */
export function uriEncode(value: string, keepSlash: boolean): string {
  let out = "";
  for (const byte of Buffer.from(value, "utf8")) {
    const c = String.fromCharCode(byte);
    if (/[A-Za-z0-9\-_.~]/.test(c) || (keepSlash && c === "/")) out += c;
    else out += "%" + byte.toString(16).toUpperCase().padStart(2, "0");
  }
  return out;
}

export interface SignInput {
  method: string;
  url: URL;
  /** Headers to sign (besides host, which comes from the URL). */
  headers: Record<string, string>;
  /** Hex SHA-256 of the body. */
  payloadHash: string;
  region: string;
  service: string;
  accessKeyId: string;
  secretAccessKey: string;
  /** `YYYYMMDDTHHMMSSZ`, also sent as x-amz-date. */
  amzDate: string;
}

/** The SigV4 Authorization header for a request. The path must already be URI-encoded. */
export function signV4(input: SignInput): { authorization: string; signature: string; canonicalRequest: string } {
  const all: Record<string, string> = { host: input.url.host };
  for (const [k, v] of Object.entries(input.headers)) all[k.toLowerCase()] = v.trim().replace(/\s+/g, " ");
  const names = Object.keys(all).sort();
  const signedHeaders = names.join(";");
  const canonicalHeaders = names.map((n) => `${n}:${all[n]}\n`).join("");
  const query = [...input.url.searchParams.entries()]
    .map(([k, v]) => [uriEncode(k, false), uriEncode(v, false)] as const)
    .sort(([a, x], [b, y]) => (a === b ? (x < y ? -1 : 1) : a < b ? -1 : 1))
    .map(([k, v]) => `${k}=${v}`)
    .join("&");
  const canonicalRequest = [
    input.method,
    input.url.pathname || "/",
    query,
    canonicalHeaders,
    signedHeaders,
    input.payloadHash,
  ].join("\n");
  const day = input.amzDate.slice(0, 8);
  const scope = `${day}/${input.region}/${input.service}/aws4_request`;
  const stringToSign = ["AWS4-HMAC-SHA256", input.amzDate, scope, sha256Hex(canonicalRequest)].join("\n");
  let key = hmac(`AWS4${input.secretAccessKey}`, day);
  key = hmac(key, input.region);
  key = hmac(key, input.service);
  key = hmac(key, "aws4_request");
  const signature = createHmac("sha256", key).update(stringToSign).digest("hex");
  return {
    authorization: `AWS4-HMAC-SHA256 Credential=${input.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
    signature,
    canonicalRequest,
  };
}

export const amzDateOf = (d: Date) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");

export class S3Error extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string | null
  ) {
    super(message);
    this.name = "S3Error";
  }
}

type Fetch = typeof fetch;

export class S3Client {
  private readonly credentials: CredentialProvider;

  constructor(
    readonly config: S3Config,
    private readonly fetchImpl: Fetch = (...args) => fetch(...args),
    credentials?: CredentialProvider
  ) {
    const { accessKeyId, secretAccessKey, sessionToken } = config;
    this.credentials =
      credentials ??
      (accessKeyId && secretAccessKey
        ? staticCredentials({ accessKeyId, secretAccessKey, sessionToken })
        : defaultCredentialChain(process.env, this.fetchImpl));
  }

  /** The URL of an object (key without the prefix). */
  objectUrl(key: string): URL {
    const { bucket, region, endpoint, forcePathStyle, prefix } = this.config;
    const base = new URL(endpoint?.trim() || `https://s3.${region}.amazonaws.com`);
    const basePath = base.pathname.replace(/\/+$/, "");
    const objectPath = uriEncode(prefix + key, true);
    if (forcePathStyle) {
      base.pathname = `${basePath}/${uriEncode(bucket, false)}/${objectPath}`;
    } else {
      base.hostname = `${bucket}.${base.hostname}`;
      base.pathname = `${basePath}/${objectPath}`;
    }
    base.search = "";
    base.hash = "";
    return base;
  }

  private async request(
    method: "GET" | "PUT" | "HEAD" | "DELETE",
    key: string,
    body?: Uint8Array,
    extraHeaders: Record<string, string> = {}
  ): Promise<Response> {
    const url = this.objectUrl(key);
    const payloadHash = body ? sha256Hex(body) : EMPTY_SHA256;
    const creds = await this.credentials();
    const amzDate = amzDateOf(new Date());
    const headers: Record<string, string> = {
      ...extraHeaders,
      "x-amz-content-sha256": payloadHash,
      "x-amz-date": amzDate,
    };
    // Temporary credentials: the token is sent and signed.
    if (creds.sessionToken) headers["x-amz-security-token"] = creds.sessionToken;
    const { authorization } = signV4({
      method,
      url,
      headers,
      payloadHash,
      region: this.config.region,
      service: "s3",
      accessKeyId: creds.accessKeyId,
      secretAccessKey: creds.secretAccessKey,
      amzDate,
    });
    const controller = new AbortController();
    const timer = setTimeout(
      () => controller.abort(new Error(`S3 ${method} timed out after ${REQUEST_TIMEOUT_MS / 1000} seconds`)),
      REQUEST_TIMEOUT_MS
    );
    timer.unref?.();
    try {
      return await this.fetchImpl(url, {
        method,
        headers: { ...headers, authorization },
        body: body ? new Uint8Array(body) : undefined,
        redirect: "manual",
        signal: controller.signal,
      });
    } finally {
      // The answer has to start in time; a long download may then take longer.
      clearTimeout(timer);
    }
  }

  private async fail(method: string, key: string, res: Response): Promise<never> {
    const text = method === "HEAD" ? "" : await res.text().catch(() => "");
    const code = /<Code>([^<]+)<\/Code>/.exec(text)?.[1] ?? null;
    throw new S3Error(`S3 ${method} ${key} failed: HTTP ${res.status}${code ? ` ${code}` : ""}`, res.status, code);
  }

  async put(key: string, body: Uint8Array, contentType = "application/octet-stream"): Promise<void> {
    const res = await this.request("PUT", key, body, { "content-type": contentType });
    if (!res.ok) await this.fail("PUT", key, res);
    await res.body?.cancel();
  }

  /** The object as a stream with its size, or null when it does not exist. */
  async get(key: string): Promise<{ body: ReadableStream<Uint8Array>; size: number | null } | null> {
    const res = await this.request("GET", key);
    if (res.status === 404) {
      await res.body?.cancel();
      return null;
    }
    if (!res.ok || !res.body) await this.fail("GET", key, res);
    const length = Number(res.headers.get("content-length"));
    return { body: res.body!, size: Number.isFinite(length) && res.headers.has("content-length") ? length : null };
  }

  /** The object's size, or null when it does not exist. */
  async head(key: string): Promise<{ size: number } | null> {
    const res = await this.request("HEAD", key);
    if (res.status === 404) return null;
    if (!res.ok) await this.fail("HEAD", key, res);
    return { size: Number(res.headers.get("content-length") ?? 0) };
  }

  /** Deletes an object; a missing object is not an error. */
  async delete(key: string): Promise<void> {
    const res = await this.request("DELETE", key);
    if (!res.ok && res.status !== 404) await this.fail("DELETE", key, res);
    await res.body?.cancel();
  }
}
