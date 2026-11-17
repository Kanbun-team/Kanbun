// User-chosen colors (tags, covers, boards, avatars) with guaranteed contrast.
// Users may pick any hex, so readable text colors are derived at render time:
// the hue is shifted toward black (light theme) or white (dark theme) until it
// reaches 4.5:1 against its own tinted chip background. See DESIGN.md 3.2.

export const PALETTE = [
  "#2563eb",
  "#7c3aed",
  "#16a34a",
  "#dc2626",
  "#ea580c",
  "#0891b2",
  "#db2777",
  "#65a30d",
  "#d97706",
  "#475569",
] as const;

// Surfaces from the design tokens (globals.css).
export const SURFACE = { light: "#ffffff", dark: "#1d222b" } as const;
const CHIP_ALPHA = 0.14;
export const MIN_CONTRAST = 4.5;

type Rgb = [number, number, number];

export function hexToRgb(hex: string): Rgb {
  const h = hex.replace("#", "");
  const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h.padEnd(6, "0").slice(0, 6);
  const n = Number.parseInt(full, 16);
  if (Number.isNaN(n)) return [100, 116, 139];
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function rgbToHex([r, g, b]: Rgb): string {
  return "#" + [r, g, b].map((v) => Math.round(v).toString(16).padStart(2, "0")).join("");
}

function channel(v: number) {
  const c = v / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

export function luminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex);
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

export function mix(a: string, b: string, t: number): string {
  const x = hexToRgb(a);
  const y = hexToRgb(b);
  return rgbToHex([0, 1, 2].map((i) => x[i] + (y[i] - x[i]) * t) as Rgb);
}

/** Shifts `hex` toward `target` in small steps until it reads on `bg`. */
export function readableOn(hex: string, bg: string, target: string, min = MIN_CONTRAST): string {
  for (let t = 0; t <= 1; t += 0.05) {
    const c = mix(hex, target, t);
    if (contrast(c, bg) >= min) return c;
  }
  return target;
}

export interface ChipColors {
  bg: string;
  fg: string;
}

export function chipColors(hex: string, theme: "light" | "dark"): ChipColors {
  const surface = SURFACE[theme];
  const bg = mix(surface, hex, CHIP_ALPHA);
  const fg = readableOn(hex, bg, theme === "light" ? "#000000" : "#ffffff");
  return { bg, fg };
}

/** Inline CSS variables consumed by the `.chip` class in globals.css. */
export function chipStyle(hex: string): Record<string, string> {
  const light = chipColors(hex, "light");
  const dark = chipColors(hex, "dark");
  return {
    "--chip-bg": light.bg,
    "--chip-fg": light.fg,
    "--chip-bg-dark": dark.bg,
    "--chip-fg-dark": dark.fg,
  };
}

/** Avatar background for initials: the user's hue, darkened until white text reaches 4.5:1. */
export function avatarColor(name: string | null | undefined): string {
  let hash = 0;
  for (const ch of name ?? "") hash = (hash * 31 + ch.charCodeAt(0)) | 0;
  const hue = PALETTE[Math.abs(hash) % PALETTE.length];
  return readableOn(hue, "#ffffff", "#000000");
}
