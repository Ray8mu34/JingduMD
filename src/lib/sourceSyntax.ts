export type SourceToken = { text: string; kind?: "heading" | "marker" | "code" | "emphasis" | "link" };

// A deliberately small, lossless Markdown colorizer. Tokens are rendered as
// React text, including HTML and incomplete syntax; they never become markup.
// Bound work while typing very large documents/lines, which stay plain text.
export function sourceSyntax(source: string): SourceToken[] {
  if (source.length > 500_000) return [{ text: source }];
  const tokens: SourceToken[] = [];
  let fence: { character: string; length: number } | undefined;
  const push = (text: string, kind?: SourceToken["kind"]) => {
    if (!text) return;
    const last = tokens[tokens.length - 1];
    if (last && last.kind === kind) last.text += text;
    else tokens.push({ text, kind });
  };
  for (const line of source.split(/(?<=\n)/)) {
    if (line.length > 8_000) { push(line, fence ? "code" : undefined); continue; }
    const boundary = /^( {0,3})(`{3,}|~{3,})(.*)/.exec(line);
    if (fence) {
      push(line, "code");
      if (boundary && boundary[2][0] === fence.character && boundary[2].length >= fence.length && !boundary[3].trim()) fence = undefined;
      continue;
    }
    if (boundary && (boundary[2][0] === "~" || !boundary[3].includes("`"))) {
      fence = { character: boundary[2][0], length: boundary[2].length };
      push(line, "code"); continue;
    }
    if (/^ {0,3}#{1,6}(?:\s|$)/.test(line)) { push(line, "heading"); continue; }
    if (/^ {0,3}(?:(?:-\s*){3,}|(?:\*\s*){3,}|(?:_\s*){3,}|={3,}\s*)$/.test(line.trimEnd())) { push(line, "marker"); continue; }
    const prefix = /^(\s*(?:(?:>\s*)+|(?:[-+*]|\d{1,9}[.)])\s+)(?:\[[ xX]\]\s+)?)/.exec(line)?.[0] ?? "";
    push(prefix, "marker");
    const body = line.slice(prefix.length);
    // Repeated unmatched brackets otherwise make the small inline matcher
    // retry from every bracket. Dense syntax stays readable without stalling.
    if ((body.match(/`|\*|_|\[|\]|~/g)?.length ?? 0) > 256) { push(body); continue; }
    // Escaped punctuation is consumed first so it cannot start a token.
    const inline = /\\[\s\S]|(`+)([^`\n]*?)\1(?!`)|!?\[[^\]\n]*\]\([^\)\n]*\)|\*\*[^*\n]+\*\*|__[^_\n]+__|~~[^~\n]+~~|\*[^*\n]+\*|(?<![\p{L}\p{N}])_[^_\n]+_(?![\p{L}\p{N}])/gu;
    let end = 0;
    for (const match of body.matchAll(inline)) {
      push(body.slice(end, match.index));
      const text = match[0];
      push(text, text.startsWith("\\") ? undefined : text.startsWith("`") ? "code" : /^!?\[/.test(text) ? "link" : "emphasis");
      end = match.index + text.length;
    }
    push(body.slice(end));
  }
  return tokens;
}
