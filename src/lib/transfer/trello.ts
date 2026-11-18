import { z } from "zod";
import { PALETTE } from "@/lib/palette";
import type { ExportBoard, ExportCard } from "./format";

// Maps a Trello board export ("Menu > Print, export and share > Export as
// JSON") onto a Kanbun board. Only the fields Kanbun has a place for are read;
// everything else in the (large) Trello file is ignored.
//
// Decisions, documented in docs/IMPORT-EXPORT.md:
// - Closed (archived) lists are skipped together with all their cards.
// - Closed (archived) cards are skipped. Both counts are reported.
// - Labels become board tags; Trello colors map to the closest palette hue.
// - All checklists of a card are merged into its one checklist; with more
//   than one checklist, items are prefixed with the checklist name.
// - Comments are authored by the importing user and start with
//   "Originally by <full name> on <date>".
// - Card members become assignees when a Kanbun user has the same username.

const id = z.string().min(1);

const trelloSchema = z.object({
  name: z.string().default("Trello board"),
  desc: z.string().nullish(),
  closed: z.boolean().nullish(),
  prefs: z.object({ background: z.string().nullish() }).partial().nullish(),
  lists: z.array(
    z.object({ id, name: z.string(), closed: z.boolean().nullish(), pos: z.number().nullish() })
  ),
  cards: z
    .array(
      z.object({
        id,
        name: z.string(),
        desc: z.string().nullish(),
        closed: z.boolean().nullish(),
        idList: id,
        pos: z.number().nullish(),
        due: z.string().nullish(),
        dateLastActivity: z.string().nullish(),
        idLabels: z.array(z.string()).nullish(),
        idMembers: z.array(z.string()).nullish(),
        cover: z.object({ color: z.string().nullish() }).partial().nullish(),
      })
    )
    .default([]),
  labels: z
    .array(z.object({ id, name: z.string().nullish(), color: z.string().nullish() }))
    .default([]),
  checklists: z
    .array(
      z.object({
        id,
        idCard: id,
        name: z.string().nullish(),
        pos: z.number().nullish(),
        checkItems: z
          .array(z.object({ name: z.string(), state: z.string().nullish(), pos: z.number().nullish() }))
          .default([]),
      })
    )
    .default([]),
  actions: z
    .array(
      z.object({
        type: z.string(),
        date: z.string().nullish(),
        data: z.object({ text: z.string().nullish(), card: z.object({ id: z.string() }).nullish() }).partial().nullish(),
        memberCreator: z.object({ fullName: z.string().nullish(), username: z.string().nullish() }).partial().nullish(),
      })
    )
    .default([]),
  members: z
    .array(z.object({ id, username: z.string().nullish(), fullName: z.string().nullish() }))
    .default([]),
});

export type TrelloBoard = z.input<typeof trelloSchema>;

/** Trello label and background colors, matched by hand to the closest palette hue. */
const TRELLO_COLORS: Record<string, (typeof PALETTE)[number]> = {
  blue: "#2563eb",
  purple: "#7c3aed",
  green: "#16a34a",
  red: "#dc2626",
  orange: "#ea580c",
  sky: "#0891b2",
  pink: "#db2777",
  lime: "#65a30d",
  yellow: "#d97706",
  black: "#475569",
  grey: "#475569",
  gray: "#475569",
};

/** Maps a Trello color name ("green", "green_dark", "sky_light") to a palette hex. */
export function trelloColor(name: string | null | undefined, fallback: string = PALETTE[9]): string {
  if (!name) return fallback;
  const base = name.toLowerCase().split("_")[0];
  return TRELLO_COLORS[base] ?? fallback;
}

export interface TrelloMapResult {
  board: ExportBoard;
  stats: {
    lists: number;
    cards: number;
    skippedLists: number;
    skippedCards: number;
    comments: number;
    checklistItems: number;
    tags: number;
  };
  /** Trello usernames on cards; the importer matches them to Kanbun users. */
  memberUsernames: string[];
}

export class TrelloFormatError extends Error {
  constructor(public readonly issues: string[]) {
    super(`Not a Trello board export: ${issues.join("; ")}`);
    this.name = "TrelloFormatError";
  }
}

const clip = (s: string, max: number) => (s.length > max ? s.slice(0, max) : s);
const byPos = <T extends { pos?: number | null }>(a: T, b: T) => (a.pos ?? 0) - (b.pos ?? 0);

function dateOnly(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

/** Validates and maps a parsed Trello JSON file. Throws TrelloFormatError. */
export function mapTrelloBoard(
  raw: unknown,
  opts: { originallyBy: (name: string, date: string) => string }
): TrelloMapResult {
  const parsed = trelloSchema.safeParse(raw);
  if (!parsed.success) {
    throw new TrelloFormatError(
      parsed.error.issues.slice(0, 5).map((i) => `${i.path.join(".") || "file"}: ${i.message}`)
    );
  }
  const src = parsed.data;

  const labelById = new Map<string, { name: string; color: string }>();
  const tagNames = new Set<string>();
  const tags: { name: string; color: string }[] = [];
  for (const label of src.labels) {
    const color = trelloColor(label.color);
    // Unnamed Trello labels are just a color; name the tag after it.
    let name = clip((label.name ?? "").trim() || (label.color ?? "label"), 40);
    // Trello allows two labels with one name; Kanbun tags need distinct names.
    if (tagNames.has(name.toLowerCase())) name = clip(`${name} (${label.color ?? "2"})`, 40);
    if (tagNames.has(name.toLowerCase())) continue;
    tagNames.add(name.toLowerCase());
    labelById.set(label.id, { name, color });
    tags.push({ name, color });
  }

  const memberById = new Map(src.members.map((m) => [m.id, m]));
  const checklistsByCard = new Map<string, typeof src.checklists>();
  for (const cl of src.checklists) {
    const list = checklistsByCard.get(cl.idCard) ?? [];
    list.push(cl);
    checklistsByCard.set(cl.idCard, list);
  }
  const commentsByCard = new Map<string, typeof src.actions>();
  for (const action of src.actions) {
    const cardId = action.data?.card?.id;
    if (action.type !== "commentCard" || !cardId || !action.data?.text?.trim()) continue;
    const list = commentsByCard.get(cardId) ?? [];
    list.push(action);
    commentsByCard.set(cardId, list);
  }

  const openLists = src.lists.filter((l) => !l.closed).sort(byPos);
  const openListIds = new Set(openLists.map((l) => l.id));
  const stats = {
    lists: openLists.length,
    cards: 0,
    skippedLists: src.lists.length - openLists.length,
    skippedCards: 0,
    comments: 0,
    checklistItems: 0,
    tags: tags.length,
  };
  const memberUsernames = new Set<string>();

  const cardsByList = new Map<string, ExportCard[]>();
  for (const card of [...src.cards].sort(byPos)) {
    if (card.closed || !openListIds.has(card.idList)) {
      stats.skippedCards += 1;
      continue;
    }
    const checklists = [...(checklistsByCard.get(card.id) ?? [])].sort(byPos);
    const checklist = checklists.flatMap((cl) =>
      [...cl.checkItems].sort(byPos).map((item) => ({
        title: clip(checklists.length > 1 && cl.name ? `${cl.name}: ${item.name}` : item.name, 500) || "-",
        done: item.state === "complete",
      }))
    );
    // Trello lists actions newest first; comments read oldest first.
    const comments = [...(commentsByCard.get(card.id) ?? [])]
      .sort((a, b) => Date.parse(a.date ?? "") - Date.parse(b.date ?? ""))
      .map((action) => {
        const who = action.memberCreator?.fullName || action.memberCreator?.username || "Trello";
        const when = dateOnly(action.date) ?? "";
        // The prefix is already in the body, so no authorName (which would add it again).
        return {
          author: null,
          body: clip(`${opts.originallyBy(who, when)}\n\n${action.data?.text?.trim() ?? ""}`, 20_000),
          createdAt: action.date && !Number.isNaN(Date.parse(action.date)) ? action.date : new Date(0).toISOString(),
        };
      });
    const assignees: string[] = [];
    for (const memberId of card.idMembers ?? []) {
      const username = memberById.get(memberId)?.username?.toLowerCase();
      if (username && !assignees.includes(username)) {
        assignees.push(username);
        memberUsernames.add(username);
      }
    }
    const cardTags = (card.idLabels ?? []).map((l) => labelById.get(l)?.name).filter((n): n is string => !!n);

    stats.cards += 1;
    stats.comments += comments.length;
    stats.checklistItems += checklist.length;
    const list = cardsByList.get(card.idList) ?? [];
    list.push({
      id: card.id,
      title: clip(card.name.trim() || "Untitled", 200),
      description: card.desc ? clip(card.desc, 20_000) : null,
      priority: "normal",
      coverColor: card.cover?.color ? trelloColor(card.cover.color) : null,
      deadline: dateOnly(card.due),
      tags: Array.from(new Set(cardTags)),
      assignees,
      checklist,
      comments,
    });
    cardsByList.set(card.idList, list);
  }

  const board: ExportBoard = {
    name: clip(src.name.trim() || "Trello board", 120),
    description: src.desc ? clip(src.desc, 2000) : null,
    color: trelloColor(src.prefs?.background, PALETTE[0]),
    tags,
    columns: (openLists.length ? openLists : [{ id: "", name: "Imported", closed: false, pos: 0 }]).map((l) => ({
      name: clip(l.name.trim() || "Untitled", 80),
      cards: cardsByList.get(l.id) ?? [],
    })),
  };
  return { board, stats, memberUsernames: Array.from(memberUsernames) };
}
