import pkg from "../../package.json";

export const APP_VERSION: string = pkg.version;

const sha = process.env.KANBUN_BUILD_SHA?.trim();
export const APP_BUILD_SHA: string | null = sha && sha.length >= 7 ? sha : null;

const date = process.env.KANBUN_BUILD_DATE?.trim();
export const APP_BUILD_DATE: string | null = date && date.length > 0 ? date : null;

const repo = process.env.KANBUN_REPO_URL?.trim();
export const APP_REPO_URL: string =
  repo && repo.startsWith("http") ? repo.replace(/\/$/, "") : "https://github.com/Kanbun-team/Kanbun";

/**
 * "v0.1.0" for tagged releases, "v0.1.0+sha-abc1234" for nightly/dev builds
 * where a build SHA was injected via KANBUN_BUILD_SHA.
 */
export function versionLabel(): string {
  if (APP_BUILD_SHA) return `v${APP_VERSION}+${APP_BUILD_SHA.slice(0, 7)}`;
  return `v${APP_VERSION}`;
}

/**
 * Best-effort link target.
 * - Tagged release: link to the release page for vX.Y.Z.
 * - Nightly with SHA: link to the commit.
 */
export function versionUrl(): string {
  if (APP_BUILD_SHA) return `${APP_REPO_URL}/commit/${APP_BUILD_SHA}`;
  return `${APP_REPO_URL}/releases/tag/v${APP_VERSION}`;
}

export function versionTooltip(): string {
  const parts = [versionLabel()];
  if (APP_BUILD_DATE) parts.push(`built ${APP_BUILD_DATE}`);
  return parts.join(" - ");
}
