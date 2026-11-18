import { t, type DictKey, type Locale } from "@/lib/i18n";

// Built-in starting points for a new board: the columns (and a few tags) a
// board gets when it is created. Names are translated into the creator's
// language at creation time; afterwards they are ordinary, editable names.

export const BOARD_TEMPLATE_IDS = ["simple", "software", "personal", "blank"] as const;
export type BoardTemplateId = (typeof BOARD_TEMPLATE_IDS)[number];

interface BoardTemplate {
  label: DictKey;
  description: DictKey;
  columns: DictKey[];
  tags: { name: DictKey; color: string }[];
}

export const BOARD_TEMPLATES: Record<BoardTemplateId, BoardTemplate> = {
  simple: {
    label: "boardTplSimple",
    description: "boardTplSimpleDesc",
    columns: ["boardColTodo", "boardColDoing", "boardColDone"],
    tags: [],
  },
  software: {
    label: "boardTplSoftware",
    description: "boardTplSoftwareDesc",
    columns: ["boardColBacklog", "boardColReady", "boardColInProgress", "boardColReview", "boardColDone"],
    tags: [
      { name: "boardTagBug", color: "#dc2626" },
      { name: "boardTagFeature", color: "#2563eb" },
      { name: "boardTagChore", color: "#64748b" },
    ],
  },
  personal: {
    label: "boardTplPersonal",
    description: "boardTplPersonalDesc",
    columns: ["boardColThisWeek", "boardColToday", "boardColDone"],
    tags: [],
  },
  blank: {
    label: "boardTplBlank",
    description: "boardTplBlankDesc",
    columns: [],
    tags: [],
  },
};

export function isBoardTemplateId(value: unknown): value is BoardTemplateId {
  return typeof value === "string" && (BOARD_TEMPLATE_IDS as readonly string[]).includes(value);
}

/** Column and tag names for a template, in the given language. */
export function boardTemplateContent(id: BoardTemplateId, locale: Locale) {
  const tpl = BOARD_TEMPLATES[id];
  return {
    columns: tpl.columns.map((key) => t(key, locale)),
    tags: tpl.tags.map((tag) => ({ name: t(tag.name, locale), color: tag.color })),
  };
}
