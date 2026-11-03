// The textarea uses LF internally. An untouched draft is never written back.
export const sourceText = (content: string) => content.replace(/\r\n?/g, "\n");

export function sourceForSave(draft: string, baseline: string): string {
  if (draft === sourceText(baseline)) return baseline;
  const endings = baseline.match(/\r\n|\r|\n/g) ?? [];
  const newline = endings.length && endings.every((ending) => ending === "\r\n") ? "\r\n"
    : endings.length && endings.every((ending) => ending === "\r") ? "\r" : "\n";
  return draft.replace(/\n/g, newline);
}

export type LeaveGuard = () => Promise<boolean>;

export function findSource(text: string, query: string, start: number, end: number, direction: number): { start: number; end: number } | null {
  if (!query) return null;
  // Search original code-unit offsets: lowercasing the full source can expand
  // Unicode characters and move a selection away from the actual match.
  const pattern = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "giu");
  let match: RegExpExecArray | null;
  if (direction > 0) {
    pattern.lastIndex = end;
    match = pattern.exec(text);
    if (!match) { pattern.lastIndex = 0; match = pattern.exec(text); }
  } else {
    let previous: RegExpExecArray | null = null, last: RegExpExecArray | null = null;
    while ((match = pattern.exec(text))) { last = match; if (match.index < start) previous = match; }
    match = previous ?? last;
  }
  return match ? { start: match.index, end: match.index + match[0].length } : null;
}
