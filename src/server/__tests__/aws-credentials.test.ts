import { describe, expect, it, vi } from "vitest";
import { cachedCredentials, defaultCredentialChain, REFRESH_BEFORE_MS, type AwsCredentials } from "@/server/aws-credentials";

// The AWS credential chain with a mocked fetch: one test per provider, then
// caching and refresh before expiry.

type Call = { url: string; method: string; headers: Headers; body: string };

function mockFetch(routes: Record<string, (call: Call) => Response>) {
  const calls: Call[] = [];
  const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const call: Call = {
      url: String(input),
      method: init?.method ?? "GET",
      headers: new Headers(init?.headers),
      body: typeof init?.body === "string" ? init.body : "",
    };
    calls.push(call);
    expect(init?.signal).toBeInstanceOf(AbortSignal);
    const route = routes[`${call.method} ${call.url}`];
    if (!route) throw new TypeError(`fetch failed: ${call.method} ${call.url}`);
    return route(call);
  }) as unknown as typeof fetch;
  return { fetchImpl, calls };
}

const neverFetch = mockFetch({}).fetchImpl;
const readToken = async (file: string) => `token-from:${file}\n`;
const later = (ms: number) => new Date(Date.now() + ms).toISOString();

describe("AWS credential chain", () => {
  it("takes the AWS_* environment variables first", async () => {
    const chain = defaultCredentialChain(
      {
        AWS_ACCESS_KEY_ID: "AKIDENV",
        AWS_SECRET_ACCESS_KEY: "env-secret",
        AWS_SESSION_TOKEN: "env-token",
        AWS_WEB_IDENTITY_TOKEN_FILE: "/ignored",
        AWS_ROLE_ARN: "arn:ignored",
      },
      neverFetch
    );
    expect(await chain()).toEqual({ accessKeyId: "AKIDENV", secretAccessKey: "env-secret", sessionToken: "env-token" });
  });

  it("exchanges a web identity token with STS", async () => {
    const { fetchImpl, calls } = mockFetch({
      "POST https://sts.eu-west-1.amazonaws.com/": () =>
        new Response(
          `<AssumeRoleWithWebIdentityResponse xmlns="https://sts.amazonaws.com/doc/2011-06-15/">
            <AssumeRoleWithWebIdentityResult><Credentials>
              <AccessKeyId>ASIAWEB</AccessKeyId>
              <SecretAccessKey>web/secret+key</SecretAccessKey>
              <SessionToken>web-session&amp;token</SessionToken>
              <Expiration>2030-01-01T00:00:00Z</Expiration>
            </Credentials></AssumeRoleWithWebIdentityResult>
          </AssumeRoleWithWebIdentityResponse>`
        ),
    });
    const chain = defaultCredentialChain(
      {
        AWS_WEB_IDENTITY_TOKEN_FILE: "/var/run/secrets/token",
        AWS_ROLE_ARN: "arn:aws:iam::123456789012:role/kanbun",
        AWS_ROLE_SESSION_NAME: "kanbun-pod",
        AWS_REGION: "eu-west-1",
      },
      fetchImpl,
      readToken
    );
    expect(await chain()).toEqual({
      accessKeyId: "ASIAWEB",
      secretAccessKey: "web/secret+key",
      sessionToken: "web-session&token",
      expiration: new Date("2030-01-01T00:00:00Z"),
    });
    const form = new URLSearchParams(calls[0].body);
    expect(Object.fromEntries(form)).toEqual({
      Action: "AssumeRoleWithWebIdentity",
      Version: "2011-06-15",
      RoleArn: "arn:aws:iam::123456789012:role/kanbun",
      RoleSessionName: "kanbun-pod",
      WebIdentityToken: "token-from:/var/run/secrets/token",
    });
  });

  it("reports an STS error", async () => {
    const { fetchImpl } = mockFetch({
      "POST https://sts.amazonaws.com/": () => new Response("<Error/>", { status: 403 }),
    });
    const chain = defaultCredentialChain({ AWS_WEB_IDENTITY_TOKEN_FILE: "/t", AWS_ROLE_ARN: "arn" }, fetchImpl, readToken);
    await expect(chain()).rejects.toThrow(/AssumeRoleWithWebIdentity failed: HTTP 403/);
  });

  it("asks the ECS container endpoint with the relative URI", async () => {
    const { fetchImpl, calls } = mockFetch({
      "GET http://169.254.170.2/v2/credentials/abc": () =>
        Response.json({ AccessKeyId: "ASIAECS", SecretAccessKey: "ecs-secret", Token: "ecs-token", Expiration: later(3_600_000) }),
    });
    const creds = await defaultCredentialChain({ AWS_CONTAINER_CREDENTIALS_RELATIVE_URI: "/v2/credentials/abc" }, fetchImpl)();
    expect(creds).toMatchObject({ accessKeyId: "ASIAECS", secretAccessKey: "ecs-secret", sessionToken: "ecs-token" });
    expect(creds.expiration).toBeInstanceOf(Date);
    expect(calls[0].headers.has("authorization")).toBe(false);
  });

  it("sends the authorization token to a full container URI (from the variable or its file)", async () => {
    const { fetchImpl, calls } = mockFetch({
      "GET http://169.254.170.23/v1/credentials": () =>
        Response.json({ AccessKeyId: "ASIAPOD", SecretAccessKey: "pod-secret", Token: "pod-token", Expiration: later(3_600_000) }),
    });
    const env = { AWS_CONTAINER_CREDENTIALS_FULL_URI: "http://169.254.170.23/v1/credentials" };
    await defaultCredentialChain({ ...env, AWS_CONTAINER_AUTHORIZATION_TOKEN: "Bearer abc" }, fetchImpl)();
    await defaultCredentialChain({ ...env, AWS_CONTAINER_AUTHORIZATION_TOKEN_FILE: "/eks/token" }, fetchImpl, readToken)();
    expect(calls.map((c) => c.headers.get("authorization"))).toEqual(["Bearer abc", "token-from:/eks/token"]);
  });

  it("falls back to EC2 instance metadata with an IMDSv2 token", async () => {
    const { fetchImpl, calls } = mockFetch({
      "PUT http://169.254.169.254/latest/api/token": () => new Response("imds-token"),
      "GET http://169.254.169.254/latest/meta-data/iam/security-credentials/": () => new Response("kanbun-role\n"),
      "GET http://169.254.169.254/latest/meta-data/iam/security-credentials/kanbun-role": () =>
        Response.json({ Code: "Success", AccessKeyId: "ASIAEC2", SecretAccessKey: "ec2-secret", Token: "ec2-token", Expiration: later(6 * 3_600_000) }),
    });
    const creds = await defaultCredentialChain({}, fetchImpl)();
    expect(creds).toMatchObject({ accessKeyId: "ASIAEC2", secretAccessKey: "ec2-secret", sessionToken: "ec2-token" });
    expect(calls[0].headers.get("x-aws-ec2-metadata-token-ttl-seconds")).toBe("21600");
    expect(calls.slice(1).map((c) => c.headers.get("x-aws-ec2-metadata-token"))).toEqual(["imds-token", "imds-token"]);
  });

  it("says where to look when nothing gives credentials", async () => {
    await expect(defaultCredentialChain({}, neverFetch)()).rejects.toThrow(/no AWS credentials found: set ATTACHMENTS_S3_ACCESS_KEY_ID/);
    await expect(defaultCredentialChain({ AWS_EC2_METADATA_DISABLED: "true" }, neverFetch)()).rejects.toThrow(/metadata is disabled/);
  });
});

describe("credential cache", () => {
  const creds = (n: number, expiresAt?: number): AwsCredentials => ({
    accessKeyId: `ASIA${n}`,
    secretAccessKey: "s",
    sessionToken: `t${n}`,
    expiration: expiresAt === undefined ? undefined : new Date(expiresAt),
  });

  it("keeps credentials until a few minutes before they expire, then refreshes", async () => {
    let now = 1_000_000;
    let n = 0;
    const load = vi.fn(async () => creds(++n, now + 60 * 60_000));
    const provider = cachedCredentials(load, () => now);
    expect((await provider()).accessKeyId).toBe("ASIA1");
    now += 60 * 60_000 - REFRESH_BEFORE_MS - 1;
    expect((await provider()).accessKeyId).toBe("ASIA1");
    expect(load).toHaveBeenCalledTimes(1);
    now += 2;
    expect((await provider()).accessKeyId).toBe("ASIA2");
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("shares one refresh between concurrent callers", async () => {
    const load = vi.fn(async () => creds(1, Date.now() + 3_600_000));
    const provider = cachedCredentials(load);
    const all = await Promise.all([provider(), provider(), provider()]);
    expect(new Set(all.map((c) => c.accessKeyId))).toEqual(new Set(["ASIA1"]));
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("keeps credentials without an expiry", async () => {
    const load = vi.fn(async () => creds(1));
    const provider = cachedCredentials(load);
    await provider();
    await provider();
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("uses still-valid credentials when a refresh fails, and fails once they expired", async () => {
    let now = 0;
    const load = vi.fn<() => Promise<AwsCredentials>>().mockResolvedValueOnce(creds(1, 10 * 60_000));
    load.mockRejectedValue(new Error("metadata down"));
    const provider = cachedCredentials(load, () => now);
    await provider();
    now = 8 * 60_000; // inside the refresh window, not expired
    expect((await provider()).accessKeyId).toBe("ASIA1");
    now = 11 * 60_000;
    await expect(provider()).rejects.toThrow(/metadata down/);
  });
});
