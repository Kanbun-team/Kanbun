import { getPlugins, isLicensed } from "@/lib/plugins";

export type Edition = "community" | "pro";

export async function getEdition(): Promise<{
  edition: Edition;
  pluginIds: string[];
}> {
  const [licensed, plugins] = await Promise.all([isLicensed(), getPlugins()]);
  const edition: Edition = licensed && plugins.length > 0 ? "pro" : "community";
  return { edition, pluginIds: plugins.map((p) => p.id) };
}

export function editionLabel(edition: Edition): string {
  return edition === "pro" ? "Pro" : "Community";
}
