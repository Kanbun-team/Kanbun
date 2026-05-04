import { readFile } from "node:fs/promises";
import { join } from "node:path";

export interface KanbunPlugin {
  id: string;
  name: string;
  version: string;
  description?: string;
  init?: () => void | Promise<void>;
}

interface PluginModule {
  default: KanbunPlugin;
}

interface Registry {
  plugins: KanbunPlugin[];
  loaded: boolean;
  licensed: boolean;
}

const registry: Registry = { plugins: [], loaded: false, licensed: false };

const dynamicImport = new Function(
  "specifier",
  "return import(specifier)"
) as (specifier: string) => Promise<PluginModule>;

async function readDependencies(): Promise<string[]> {
  try {
    const raw = await readFile(join(process.cwd(), "package.json"), "utf8");
    const pkg = JSON.parse(raw) as {
      dependencies?: Record<string, string>;
    };
    return Object.keys(pkg.dependencies ?? {});
  } catch {
    return [];
  }
}

async function loadPlugins(): Promise<void> {
  if (registry.loaded) return;
  registry.loaded = true;

  const licenseKey = process.env.KANBUN_LICENSE_KEY?.trim();
  if (!licenseKey) return;
  registry.licensed = true;

  const deps = await readDependencies();
  const proPackages = deps.filter((name) => name.startsWith("@kanbun/pro-"));

  for (const name of proPackages) {
    try {
      const mod = await dynamicImport(name);
      if (mod?.default?.id) {
        registry.plugins.push(mod.default);
        await mod.default.init?.();
      }
    } catch (err) {
      console.warn(`Kanbun: failed to load plugin '${name}':`, err);
    }
  }
}

export async function getPlugins(): Promise<KanbunPlugin[]> {
  await loadPlugins();
  return [...registry.plugins];
}

export async function isLicensed(): Promise<boolean> {
  await loadPlugins();
  return registry.licensed;
}
