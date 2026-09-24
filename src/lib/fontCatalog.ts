import { invoke, isTauri } from "@tauri-apps/api/core";
import type { SystemFont } from "../types";

let cached: SystemFont[] | null = null;
let pending: Promise<SystemFont[]> | null = null;

export function canonicalFontFamily(fonts: SystemFont[], value: string): string {
  const needle = value.trim().toLocaleLowerCase();
  if (!needle) return "";
  return fonts.find((font) => [font.family, font.displayName, ...(font.aliases ?? [])]
    .some((name) => name?.toLocaleLowerCase() === needle))?.family ?? value;
}

export function matchingFonts(fonts: SystemFont[], query: string): SystemFont[] {
  const needle = query.trim().toLocaleLowerCase();
  if (!needle) return fonts;
  return fonts.filter((font) => [font.family, font.displayName, ...(font.aliases ?? [])]
    .some((name) => name?.toLocaleLowerCase().includes(needle)));
}

export async function loadFontCatalog(refresh = false): Promise<SystemFont[]> {
  if (!isTauri()) return [];
  if (!refresh && cached) return cached;
  if (!refresh && pending) return pending;
  const request = invoke<SystemFont[]>("list_system_fonts").then((fonts) => {
    const deduped = new Map<string, SystemFont>();
    for (const font of fonts) if (font.family.trim()) deduped.set(font.family.toLocaleLowerCase(), font);
    cached = [...deduped.values()].sort((left, right) => left.family.localeCompare(right.family, "zh-CN"));
    return cached;
  });
  pending = request;
  try { return await request; }
  finally { if (pending === request) pending = null; }
}
