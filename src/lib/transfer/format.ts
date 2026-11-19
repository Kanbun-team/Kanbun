import { z } from "zod";

// The Kanbun export format, version 1. Documented in docs/IMPORT-EXPORT.md.
// A board export holds one board; a full (admin) export holds every board plus
// users, categories and card templates. People are referenced by username, not
// id, so a file can be imported on another Kanbun instance. Card `id`s are
// only used to link blockers inside the file; the importer creates new ids.
// Client-safe: the import page validates files with these schemas too.

export const EXPORT_FORMAT = "kanbun-export";
export const EXPORT_VERSION = 1;

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "expected YYYY-MM-DD");
const isoDateTime = z.string().refine((s) => !Number.isNaN(Date.parse(s)), "expected an ISO date");
const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/);
const username = z.string().min(1).max(64);

export const exportChecklistItemSchema = z.object({
  title: z.string().min(1).max(500),
  done: z.boolean().default(false),
  dueDate: isoDate.nullable().optional(),
  assignee: username.nullable().optional(),
});

export const exportCommentSchema = z.object({
  /** Username of the author, null when unknown (imported from elsewhere). */
  author: username.nullable().optional(),
  /** Display name, shown in "Originally by" when the author is not found. */
  authorName: z.string().max(200).nullable().optional(),
  body: z.string().min(1).max(20_000),
  createdAt: isoDateTime,
});

export const exportActivitySchema = z.object({
  type: z.string().min(1).max(64),
  data: z.record(z.string(), z.unknown()).default({}),
  actor: username.nullable().optional(),
  createdAt: isoDateTime,
});

export const exportAttachmentSchema = z.object({
  fileName: z.string().max(255),
  mimeType: z.string().max(255),
  size: z.number().int().min(0),
  createdAt: isoDateTime,
});

export const exportCardSchema = z.object({
  id: z.string().min(1).max(64),
  title: z.string().min(1).max(500),
  description: z.string().max(50_000).nullable().optional(),
  priority: z.enum(["low", "normal", "high", "critical"]).default("normal"),
  coverColor: hex.nullable().optional(),
  deadline: isoDate.nullable().optional(),
  createdAt: isoDateTime.optional(),
  createdBy: username.nullable().optional(),
  tags: z.array(z.string().min(1).max(40)).default([]),
  assignees: z.array(username).default([]),
  checklist: z.array(exportChecklistItemSchema).default([]),
  comments: z.array(exportCommentSchema).default([]),
  /** Ids of cards in this file that this card blocks. */
  blocks: z.array(z.string().min(1).max(64)).default([]),
  /** Metadata only: file contents are in the admin backup, not in exports. */
  attachments: z.array(exportAttachmentSchema).default([]),
  activity: z.array(exportActivitySchema).optional(),
});

export const exportColumnSchema = z.object({
  name: z.string().min(1).max(80),
  wipLimit: z.number().int().min(1).max(999).nullable().optional(),
  cards: z.array(exportCardSchema).default([]),
});

export const exportTagSchema = z.object({
  name: z.string().min(1).max(40),
  color: hex,
});

/**
 * An automation rule. Columns, tags and people are named, like everywhere
 * in the file. Actions are kept loose on purpose: the importer skips action
 * types it does not know (from a newer Kanbun) instead of refusing the file.
 * Added in v1.4 without a version bump: older files simply have none.
 */
export const exportAutomationSchema = z.object({
  name: z.string().min(1).max(80),
  enabled: z.boolean().default(true),
  trigger: z.string().min(1).max(64),
  /** The column of a "cardEntersColumn" rule. */
  column: z.string().max(80).nullable().optional(),
  actions: z.array(z.looseObject({ type: z.string().min(1).max(64) })).max(50).default([]),
});

export const exportBoardSchema = z.object({
  name: z.string().min(1).max(120),
  description: z.string().max(2000).nullable().optional(),
  color: hex.default("#2563eb"),
  archived: z.boolean().default(false),
  category: z.string().max(80).nullable().optional(),
  createdAt: isoDateTime.optional(),
  members: z.array(z.object({ username, role: z.enum(["owner", "member"]) })).default([]),
  tags: z.array(exportTagSchema).default([]),
  columns: z.array(exportColumnSchema).max(200),
  templates: z
    .array(
      z.object({
        name: z.string().min(1).max(80),
        title: z.string().min(1).max(500),
        description: z.string().max(50_000).nullable().optional(),
        priority: z.enum(["low", "normal", "high", "critical"]).default("normal"),
        tags: z.array(z.string()).default([]),
        checklist: z.array(z.string()).default([]),
      })
    )
    .default([]),
  automations: z.array(exportAutomationSchema).max(200).default([]),
});

export const exportUserSchema = z.object({
  username,
  displayName: z.string().nullable().optional(),
  role: z.string(),
  email: z.string().nullable().optional(),
  deactivated: z.boolean().default(false),
  createdAt: isoDateTime,
});

export const kanbunExportSchema = z.object({
  format: z.literal(EXPORT_FORMAT),
  version: z.literal(EXPORT_VERSION),
  kind: z.enum(["board", "full"]),
  exportedAt: isoDateTime,
  app: z.object({ name: z.string(), version: z.string() }).optional(),
  boards: z.array(exportBoardSchema).min(1).max(1000),
  users: z.array(exportUserSchema).optional(),
  categories: z.array(z.object({ name: z.string(), color: z.string() })).optional(),
});

export type ExportChecklistItem = z.input<typeof exportChecklistItemSchema>;
export type ExportComment = z.input<typeof exportCommentSchema>;
export type ExportCard = z.input<typeof exportCardSchema>;
export type ExportColumn = z.input<typeof exportColumnSchema>;
export type ExportBoard = z.input<typeof exportBoardSchema>;
export type ExportAutomation = z.input<typeof exportAutomationSchema>;
export type KanbunExport = z.input<typeof kanbunExportSchema>;
/** A board after validation, with defaults filled in. What the importer writes. */
export type ImportBoard = z.output<typeof exportBoardSchema>;

/** True when a parsed JSON value claims to be a Kanbun export (any version). */
export function looksLikeKanbunExport(value: unknown): boolean {
  return typeof value === "object" && value !== null && (value as { format?: unknown }).format === EXPORT_FORMAT;
}

/** "Website relaunch" -> "website-relaunch", for download file names. */
export function fileSlug(name: string): string {
  const slug = name
    .replace(/ł/g, "l")
    .replace(/Ł/g, "L")
    .replace(/ß/g, "ss")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return slug || "board";
}
