/** Display preferences stay local; Markdown and image files are never rewritten. */
export function imageSizeKey(documentPath: string, source: string): string {
  return `jingreader:image-scale:v2:${JSON.stringify([documentPath, source])}`;
}

export function readImageWidth(key: string): number | null {
  try {
    const value = Number(localStorage.getItem(key));
    return Number.isFinite(value) && value >= 1 && value <= 400 ? value : null;
  } catch { return null; }
}

export function saveImageWidth(key: string, width: number | null): void {
  try {
    if (width === null) localStorage.removeItem(key);
    else localStorage.setItem(key, String(width));
  } catch { /* The current reading session still works when storage is unavailable. */ }
}
