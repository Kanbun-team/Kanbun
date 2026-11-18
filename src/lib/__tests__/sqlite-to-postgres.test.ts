import { Prisma } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { copyPlan, parentsFirst } from "../../../scripts/sqlite-to-postgres";

describe("sqlite-to-postgres copy plan", () => {
  const plan = copyPlan(Prisma.dmmf.datamodel.models);
  const index = (model: string) => plan.findIndex((p) => p.model === model);

  it("covers every model once", () => {
    expect(plan.map((p) => p.model).sort()).toEqual(Prisma.dmmf.datamodel.models.map((m) => m.name).sort());
  });

  it("puts every model after the models it references", () => {
    for (const model of Prisma.dmmf.datamodel.models) {
      for (const field of model.fields) {
        if (field.kind !== "object" || !field.relationFromFields?.length || field.type === model.name) continue;
        expect(index(field.type), `${field.type} before ${model.name}`).toBeLessThan(index(model.name));
      }
    }
  });

  it("pages through each table by its primary key", () => {
    expect(plan.find((p) => p.model === "User")?.orderBy).toEqual(["id"]);
    expect(plan.find((p) => p.model === "BoardMember")?.orderBy).toEqual(["boardId", "userId"]);
    expect(plan.find((p) => p.model === "User")?.delegate).toBe("user");
  });

  it("orders self-referencing rows parents first", () => {
    const rows = [
      { id: "c", parentId: "b" },
      { id: "b", parentId: "a" },
      { id: "a", parentId: null },
      { id: "x", parentId: "missing" },
    ];
    expect(parentsFirst(rows, "parentId", "id").map((r) => r.id)).toEqual(["a", "x", "b", "c"]);
    expect(() => parentsFirst([{ id: "a", parentId: "b" }, { id: "b", parentId: "a" }], "parentId", "id")).toThrow(/cycle/);
  });
});
