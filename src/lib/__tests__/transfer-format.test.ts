import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import en from "@/locales/en.json";
import { parseCsv } from "@/lib/csv";
import {
  EXPORT_FORMAT,
  EXPORT_VERSION,
  fileSlug,
  kanbunExportSchema,
  looksLikeKanbunExport,
  type KanbunExport,
} from "@/lib/transfer/format";
import { guessMapping, parseCsvDate, planCsvImport, splitList } from "@/lib/transfer/csv-import";
import { auditActionKey, auditActionLabel } from "@/lib/audit-labels";

const sample: KanbunExport = {
  format: EXPORT_FORMAT,
  version: EXPORT_VERSION,
  kind: "board",
  exportedAt: "2026-11-18T10:00:00.000Z",
  app: { name: "Kanbun", version: "1.0.0" },
  boards: [
    {
      name: "Website relaunch",
      color: "#2563eb",
      members: [{ username: "admin", role: "owner" }],
      tags: [{ name: "design", color: "#7c3aed" }],
      columns: [
        {
          name: "To do",
          cards: [
            {
              id: "c1",
              title: "Hero section",
              priority: "high",
              deadline: "2026-12-01",
              tags: ["design"],
              assignees: ["marta"],
              checklist: [{ title: "Sketch", done: true }],
              comments: [{ author: "admin", body: "Looks good", createdAt: "2026-11-01T10:00:00.000Z" }],
              blocks: ["c2"],
            },
            { id: "c2", title: "Footer" },
          ],
        },
      ],
    },
  ],
};

describe("Kanbun export format", () => {
  it("validates a version 1 export and fills defaults", () => {
    const parsed = kanbunExportSchema.parse(sample);
    const card = parsed.boards[0].columns[0].cards[1];
    expect(card).toMatchObject({ priority: "normal", tags: [], assignees: [], checklist: [], comments: [], blocks: [] });
    expect(parsed.boards[0].archived).toBe(false);
    expect(looksLikeKanbunExport(sample)).toBe(true);
    expect(looksLikeKanbunExport({ name: "trello" })).toBe(false);
  });

  it("rejects other versions, bad dates and unnamed boards", () => {
    expect(kanbunExportSchema.safeParse({ ...sample, version: 2 }).success).toBe(false);
    const badDate = structuredClone(sample);
    badDate.boards[0].columns[0].cards![0].deadline = "01/12/2026";
    expect(kanbunExportSchema.safeParse(badDate).success).toBe(false);
    const noName = structuredClone(sample);
    noName.boards[0].name = "";
    expect(kanbunExportSchema.safeParse(noName).success).toBe(false);
  });

  it("is documented with the same version", () => {
    const doc = readFileSync(path.join(process.cwd(), "docs/IMPORT-EXPORT.md"), "utf8");
    expect(doc).toContain(`"format": "${EXPORT_FORMAT}"`);
    expect(doc).toContain(`"version": ${EXPORT_VERSION}`);
  });

  it("makes safe file names", () => {
    expect(fileSlug("Website relaunch")).toBe("website-relaunch");
    expect(fileSlug("Zażółć gęślą jaźń!")).toBe("zazolc-gesla-jazn");
    expect(fileSlug("???")).toBe("board");
  });
});

describe("CSV import plan", () => {
  const ctx = { columns: ["To do", "Done"], tags: ["Design"], members: ["marta", "tomek"] };

  it("guesses the mapping from headers, including the export's own headers", () => {
    const headers = ["Title", "Description", "Column", "priority", "Due date", "Labels", "Assignees", "checklist"];
    expect(guessMapping(headers)).toEqual({
      title: 0,
      description: 1,
      column: 2,
      priority: 3,
      deadline: 4,
      tags: 5,
      assignees: 6,
    });
    expect(guessMapping(["foo"]).title).toBeNull();
  });

  it("recognizes headers and priority names in the newer UI languages", () => {
    const all = { title: 0, description: 1, column: 2, priority: 3, deadline: 4, tags: 5, assignees: 6 };
    expect(guessMapping(["Titre", "Description", "Colonne", "Priorité", "Échéance", "Étiquettes", "Responsables"])).toEqual(all);
    expect(guessMapping(["Título", "Descripción", "Columna", "Prioridad", "Fecha límite", "Etiquetas", "Asignados"])).toEqual(all);
    expect(guessMapping(["Título", "Descrição", "Coluna", "Prioridade", "Prazo", "Etiquetas", "Responsáveis"])).toEqual(all);
    expect(guessMapping(["Titel", "Beschrijving", "Kolom", "Prioriteit", "Vervaldatum", "Tags", "Uitvoerders"])).toEqual(all);
    expect(guessMapping(["Název", "Popis", "Sloupec", "Priorita", "Termín", "Štítky", "Řešitelé"])).toEqual(all);
    expect(guessMapping(["Назва", "Опис", "Колонка", "Пріоритет", "Термін", "Мітки", "Виконавці"])).toEqual(all);

    const mapping = { title: 0, description: null, column: null, priority: 1, deadline: null, tags: null, assignees: null };
    const rows = [["a", "Hoog"], ["b", "Kritická"], ["c", "Низький"], ["d", "Normaal"]];
    const plan = planCsvImport(rows, mapping, ctx);
    expect(plan.cards.map((c) => c.priority)).toEqual(["high", "critical", "low", "normal"]);
  });

  it("plans cards, matches existing columns and tags, and reports problems", () => {
    const rows = parseCsv(
      [
        "title;column;priority;deadline;tags;assignees",
        "Write copy;to do;high;2026-12-01;design, SEO;marta, nobody",
        ";Done;;;;",
        "Ship it;Review;urgent;31.12.2026;;@Tomek",
        "Odd;;whenever;tomorrow;;",
      ].join("\n")
    );
    const plan = planCsvImport(rows.slice(1), guessMapping(rows[0]), ctx);
    expect(plan.cards.map((c) => [c.title, c.column, c.priority, c.deadline, c.tags, c.assignees])).toEqual([
      ["Write copy", "To do", "high", "2026-12-01", ["Design", "SEO"], ["marta"]],
      ["Ship it", "Review", "critical", "2026-12-31", [], ["tomek"]],
      ["Odd", "To do", "normal", null, [], []],
    ]);
    expect(plan.errors).toEqual([{ line: 3, kind: "missingTitle" }]);
    expect(plan.warnings).toEqual([
      { line: 2, kind: "unknownUser", value: "nobody" },
      { line: 5, kind: "badPriority", value: "whenever" },
      { line: 5, kind: "badDeadline", value: "tomorrow" },
    ]);
    expect(plan.newColumns).toEqual(["Review"]);
    expect(plan.newTags).toEqual(["SEO"]);
  });

  it("parses dates strictly and splits lists", () => {
    expect(parseCsvDate("2026-02-30")).toBeNull();
    expect(parseCsvDate("2026-11-18T10:00:00Z")).toBe("2026-11-18");
    expect(parseCsvDate("5/3/2026")).toBe("2026-03-05");
    expect(splitList("a, b;a | c")).toEqual(["a", "b", "c"]);
  });
});

describe("audit action labels", () => {
  it("every AuditAction has an i18n key", () => {
    const source = readFileSync(path.join(process.cwd(), "src/server/audit.ts"), "utf8");
    const union = source.slice(source.indexOf("export type AuditAction"), source.indexOf("(string & {})"));
    const actions = Array.from(union.matchAll(/"([\w.]+)"/g), (m) => m[1]);
    expect(actions.length).toBeGreaterThan(10);
    const missing = actions.filter((a) => !(auditActionKey(a) in en));
    expect(missing).toEqual([]);
  });

  it("falls back to the raw action name", () => {
    expect(auditActionLabel("login.success", "en")).toBe("Signed in");
    expect(auditActionLabel("something.new", "en")).toBe("something.new");
  });
});
