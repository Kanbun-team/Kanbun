import { readFile } from "node:fs/promises";

// AWS credentials for the S3 client when no static ATTACHMENTS_S3_* keys are
// set. A small subset of the AWS SDK's default chain, tried in this order:
//
// 1. AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY and optional AWS_SESSION_TOKEN.
// 2. Web identity (EKS IRSA): AWS_WEB_IDENTITY_TOKEN_FILE and AWS_ROLE_ARN,
//    exchanged with STS AssumeRoleWithWebIdentity.
// 3. Container credentials (ECS, EKS Pod Identity):
//    AWS_CONTAINER_CREDENTIALS_RELATIVE_URI or _FULL_URI, with
//    AWS_CONTAINER_AUTHORIZATION_TOKEN(_FILE) when set.
// 4. EC2 instance metadata (IMDSv2): a session token, then the role's
//    credentials.
//
// Temporary credentials are cached and fetched again a few minutes before
// they expire.

export interface AwsCredentials {
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string;
  /** When temporary credentials stop working; unset for long-lived keys. */
  expiration?: Date;
}

export type CredentialProvider = () => Promise<AwsCredentials>;

type Env = Record<string, string | undefined>;
type Fetch = typeof fetch;
type ReadText = (path: string, encoding: "utf8") => Promise<string>;

/** Refresh this long before expiry. */
export const REFRESH_BEFORE_MS = 5 * 60_000;
const METADATA_TIMEOUT_MS = 1_000;
const STS_TIMEOUT_MS = 10_000;

export const staticCredentials =
  (creds: AwsCredentials): CredentialProvider =>
  async () =>
    creds;

/**
 * Caches what `load` returns until shortly before it expires; concurrent
 * callers share one refresh. If a refresh fails while the old credentials are
 * still valid, those are used.
 */
export function cachedCredentials(load: CredentialProvider, now: () => number = Date.now): CredentialProvider {
  let current: AwsCredentials | null = null;
  let pending: Promise<AwsCredentials> | null = null;
  const fresh = (c: AwsCredentials) => !c.expiration || c.expiration.getTime() - now() > REFRESH_BEFORE_MS;
  return async () => {
    if (current && fresh(current)) return current;
    pending ??= load()
      .then((c) => (current = c))
      .finally(() => (pending = null));
    try {
      return await pending;
    } catch (err) {
      if (current?.expiration && current.expiration.getTime() > now()) return current;
      throw err;
    }
  };
}

async function fetchWithTimeout(fetchImpl: Fetch, url: string, init: RequestInit, ms: number): Promise<Response> {
  return fetchImpl(url, { ...init, signal: AbortSignal.timeout(ms) });
}

async function okText(res: Response, what: string): Promise<string> {
  const text = await res.text();
  if (!res.ok) throw new Error(`${what} failed: HTTP ${res.status}`);
  return text;
}

/** The JSON shape that ECS, EKS Pod Identity and EC2 metadata answer with. */
function fromMetadataJson(text: string, what: string): AwsCredentials {
  let json: { AccessKeyId?: string; SecretAccessKey?: string; Token?: string; Expiration?: string };
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`${what}: not JSON`);
  }
  if (!json.AccessKeyId || !json.SecretAccessKey) throw new Error(`${what}: no AccessKeyId or SecretAccessKey`);
  return {
    accessKeyId: json.AccessKeyId,
    secretAccessKey: json.SecretAccessKey,
    sessionToken: json.Token || undefined,
    expiration: json.Expiration ? new Date(json.Expiration) : undefined,
  };
}

const xmlValue = (xml: string, tag: string) => new RegExp(`<${tag}>([^<]*)</${tag}>`).exec(xml)?.[1];
const unescapeXml = (s: string) =>
  s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");

export async function webIdentityCredentials(env: Env, fetchImpl: Fetch, read: ReadText = readFile): Promise<AwsCredentials> {
  const token = (await read(env.AWS_WEB_IDENTITY_TOKEN_FILE!, "utf8")).trim();
  const region = env.AWS_REGION?.trim() || env.AWS_DEFAULT_REGION?.trim();
  const url = region ? `https://sts.${region}.amazonaws.com/` : "https://sts.amazonaws.com/";
  const body = new URLSearchParams({
    Action: "AssumeRoleWithWebIdentity",
    Version: "2011-06-15",
    RoleArn: env.AWS_ROLE_ARN!.trim(),
    RoleSessionName: env.AWS_ROLE_SESSION_NAME?.trim() || `kanbun-${Date.now()}`,
    WebIdentityToken: token,
  });
  const res = await fetchWithTimeout(
    fetchImpl,
    url,
    { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: body.toString() },
    STS_TIMEOUT_MS
  );
  const xml = await okText(res, "STS AssumeRoleWithWebIdentity");
  const accessKeyId = xmlValue(xml, "AccessKeyId");
  const secretAccessKey = xmlValue(xml, "SecretAccessKey");
  const sessionToken = xmlValue(xml, "SessionToken");
  const expiration = xmlValue(xml, "Expiration");
  if (!accessKeyId || !secretAccessKey || !sessionToken) {
    throw new Error("STS AssumeRoleWithWebIdentity: no credentials in the answer");
  }
  return {
    accessKeyId,
    secretAccessKey: unescapeXml(secretAccessKey),
    sessionToken: unescapeXml(sessionToken),
    expiration: expiration ? new Date(expiration) : undefined,
  };
}

export async function containerCredentials(env: Env, fetchImpl: Fetch, read: ReadText = readFile): Promise<AwsCredentials> {
  const relative = env.AWS_CONTAINER_CREDENTIALS_RELATIVE_URI?.trim();
  const url = relative ? `http://169.254.170.2${relative}` : env.AWS_CONTAINER_CREDENTIALS_FULL_URI!.trim();
  const tokenFile = env.AWS_CONTAINER_AUTHORIZATION_TOKEN_FILE?.trim();
  const token = tokenFile ? (await read(tokenFile, "utf8")).trim() : env.AWS_CONTAINER_AUTHORIZATION_TOKEN?.trim();
  const res = await fetchWithTimeout(
    fetchImpl,
    url,
    { headers: token ? { authorization: token } : {} },
    STS_TIMEOUT_MS
  );
  return fromMetadataJson(await okText(res, "Container credentials"), "Container credentials");
}

export async function instanceMetadataCredentials(env: Env, fetchImpl: Fetch): Promise<AwsCredentials> {
  const base = (env.AWS_EC2_METADATA_SERVICE_ENDPOINT?.trim() || "http://169.254.169.254").replace(/\/+$/, "");
  const token = await okText(
    await fetchWithTimeout(
      fetchImpl,
      `${base}/latest/api/token`,
      { method: "PUT", headers: { "x-aws-ec2-metadata-token-ttl-seconds": "21600" } },
      METADATA_TIMEOUT_MS
    ),
    "EC2 metadata token"
  );
  const headers = { "x-aws-ec2-metadata-token": token };
  const roles = await okText(
    await fetchWithTimeout(fetchImpl, `${base}/latest/meta-data/iam/security-credentials/`, { headers }, METADATA_TIMEOUT_MS),
    "EC2 metadata role"
  );
  const role = roles.split("\n")[0]?.trim();
  if (!role) throw new Error("EC2 metadata: no IAM role attached to this instance");
  const res = await fetchWithTimeout(
    fetchImpl,
    `${base}/latest/meta-data/iam/security-credentials/${encodeURIComponent(role)}`,
    { headers },
    METADATA_TIMEOUT_MS
  );
  return fromMetadataJson(await okText(res, "EC2 metadata credentials"), "EC2 metadata credentials");
}

/** The default chain, cached. `env` is read on every refresh. */
export function defaultCredentialChain(env: Env, fetchImpl: Fetch, read: ReadText = readFile): CredentialProvider {
  return cachedCredentials(async () => {
    const id = env.AWS_ACCESS_KEY_ID?.trim();
    const secret = env.AWS_SECRET_ACCESS_KEY?.trim();
    if (id && secret) return { accessKeyId: id, secretAccessKey: secret, sessionToken: env.AWS_SESSION_TOKEN?.trim() || undefined };
    if (env.AWS_WEB_IDENTITY_TOKEN_FILE?.trim() && env.AWS_ROLE_ARN?.trim()) return webIdentityCredentials(env, fetchImpl, read);
    if (env.AWS_CONTAINER_CREDENTIALS_RELATIVE_URI?.trim() || env.AWS_CONTAINER_CREDENTIALS_FULL_URI?.trim()) {
      return containerCredentials(env, fetchImpl, read);
    }
    if (/^true$/i.test(env.AWS_EC2_METADATA_DISABLED?.trim() ?? "")) {
      throw new Error("no AWS credentials found (EC2 instance metadata is disabled)");
    }
    try {
      return await instanceMetadataCredentials(env, fetchImpl);
    } catch (err) {
      throw new Error(
        `no AWS credentials found: set ATTACHMENTS_S3_ACCESS_KEY_ID and ATTACHMENTS_S3_SECRET_ACCESS_KEY, the AWS_* variables, or run with an IAM role (${(err as Error).message})`
      );
    }
  });
}
