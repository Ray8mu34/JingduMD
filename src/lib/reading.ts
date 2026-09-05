export type ReadingMetrics = {
  characters: number;
  cjkCharacters: number;
  latinWords: number;
  minutes: number;
};

export function readingMetrics(markdown: string): ReadingMetrics {
  const text = markdown
    .replace(/^---\s*\r?\n[\s\S]*?\r?\n---\s*(?:\r?\n|$)/, " ")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`[^`]*`/g, " ")
    .replace(/!\[[^\]]*]\([^)]*\)/g, " ")
    .replace(/\[([^\]]+)]\([^)]*\)/g, "$1")
    .replace(/<[^>]+>/g, " ")
    .replace(/[#>*_~|=-]/g, " ");
  const cjkCharacters = (text.match(/[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/g) ?? []).length;
  const latinWords = (text.match(/[A-Za-zÀ-ž]+(?:['’-][A-Za-zÀ-ž]+)*/g) ?? []).length;
  const characters = text.replace(/\s/g, "").length;
  const minutes = Math.max(1, Math.ceil(cjkCharacters / 450 + latinWords / 220));
  return { characters, cjkCharacters, latinWords, minutes };
}

export function formatModifiedTime(modifiedMs: number): string {
  if (!Number.isFinite(modifiedMs) || modifiedMs <= 0) return "";
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit"
  }).format(new Date(modifiedMs));
}
