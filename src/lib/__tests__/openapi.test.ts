import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";
import spec from "../../../docs/openapi.json";

// docs/openapi.json must describe exactly the route handlers under
// src/app/api/v1 (the catch-all 404 route aside).
const ROOT = join(__dirname, "../../app/api/v1");
const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"];

function routeFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return routeFiles(full);
    return name === "route.ts" ? [full] : [];
  });
}

function implemented(): string[] {
  const out: string[] = [];
  for (const file of routeFiles(ROOT)) {
    const dir = relative(ROOT, file).split(sep).slice(0, -1);
    if (dir.some((part) => part.startsWith("[..."))) continue;
    const path = "/" + dir.map((p) => p.replace(/^\[(\w+)\]$/, "{$1}")).join("/");
    const source = readFileSync(file, "utf8");
    for (const m of METHODS) {
      if (new RegExp(`export (const|async function|function) ${m}\\b`).test(source)) out.push(`${m} ${path}`);
    }
  }
  return out.sort();
}

function documented(): string[] {
  const out: string[] = [];
  for (const [path, item] of Object.entries(spec.paths as Record<string, Record<string, unknown>>)) {
    for (const m of METHODS) if (item[m.toLowerCase()]) out.push(`${m} ${path}`);
  }
  return out.sort();
}

describe("OpenAPI spec", () => {
  it("is OpenAPI 3.1", () => {
    expect(spec.openapi).toBe("3.1.0");
  });

  it("matches the implemented routes", () => {
    expect(documented()).toEqual(implemented());
  });

  it("only references defined components", () => {
    const text = JSON.stringify(spec);
    const refs = [...text.matchAll(/"\$ref":"#\/components\/(\w+)\/(\w+)"/g)];
    const components = spec.components as Record<string, Record<string, unknown>>;
    const missing = refs.filter(([, kind, name]) => !components[kind]?.[name]).map(([ref]) => ref);
    expect(missing).toEqual([]);
  });
});
