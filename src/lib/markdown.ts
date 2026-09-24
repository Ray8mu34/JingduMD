import type { Root, Text, Link, Heading, PhrasingContent, Blockquote, Paragraph } from "mdast";
import { visit } from "unist-util-visit";
import DOMPurify from "dompurify";
import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import remarkFrontmatter from "remark-frontmatter";
import type { OutlineItem } from "../types";

export function slugify(input: string, used = new Map<string, number>()): string {
  const base = input.trim().toLowerCase()
    .replace(/[`*_~[\]{}()<>]/g, "")
    .replace(/[^\p{Letter}\p{Number}\u4e00-\u9fff]+/gu, "-")
    .replace(/^-+|-+$/g, "") || "section";
  const count = used.get(base) ?? 0;
  used.set(base, count + 1);
  return count ? `${base}-${count}` : base;
}

export function extractOutline(markdown: string): OutlineItem[] {
  const result: OutlineItem[] = [];
  const body = normalizeTexDelimiters(splitFrontmatter(markdown).body);
  const processor = unified().use(remarkParse).use(remarkGfm).use(remarkMath).use(remarkFrontmatter)
    .use(remarkWikiLinks).use(remarkHeadingIds);
  const tree = processor.runSync(processor.parse(body)) as Root;
  visit(tree, "heading", (node: Heading) => {
    const text = plainText(node.children);
    const id = String((node.data?.hProperties as { id?: string } | undefined)?.id ?? "");
    result.push({ level: node.depth, text, id: `user-content-${id}` });
  });
  return result;
}

export function splitFrontmatter(markdown: string): { frontmatter: string[]; body: string } {
  if (!markdown.startsWith("---\n") && !markdown.startsWith("---\r\n")) return { frontmatter: [], body: markdown };
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/.exec(markdown);
  if (!match) return { frontmatter: [], body: markdown };
  return { frontmatter: match[1].split(/\r?\n/).filter(Boolean), body: markdown.slice(match[0].length) };
}

function normalizeInlineTex(line: string): string {
  let result = "";
  let cursor = 0;
  let codeFence = "";

  while (cursor < line.length) {
    if (line[cursor] === "`") {
      const run = line.slice(cursor).match(/^`+/)?.[0] ?? "`";
      if (!codeFence) codeFence = run;
      else if (run === codeFence) codeFence = "";
      result += run;
      cursor += run.length;
      continue;
    }

    if (!codeFence && line.startsWith("\\(", cursor)) {
      const end = line.indexOf("\\)", cursor + 2);
      if (end >= 0) {
        const source = line.slice(cursor + 2, end);
        result += `$${source}$`;
        cursor = end + 2;
        continue;
      }
    }

    if (!codeFence && line.startsWith("\\[", cursor)) {
      const end = line.indexOf("\\]", cursor + 2);
      if (end >= 0) {
        const source = line.slice(cursor + 2, end);
        result += `$$${source}$$`;
        cursor = end + 2;
        continue;
      }
    }

    result += line[cursor];
    cursor += 1;
  }

  return result;
}

/** Convert standard TeX \(...\) / \[...\] delimiters for remark-math.
 * Fenced and inline code are deliberately left untouched.
 */
export function normalizeTexDelimiters(markdown: string): string {
  const lines = markdown.split(/(\r?\n)/);
  let fencedWith = "";
  let displayMath = false;

  return lines.map((line) => {
    if (/^\r?\n$/.test(line)) return line;

    const fence = /^\s*(`{3,}|~{3,})/.exec(line)?.[1] ?? "";
    if (fence) {
      if (!fencedWith) fencedWith = fence[0];
      else if (fence[0] === fencedWith) fencedWith = "";
      return line;
    }
    if (fencedWith) return line;

    if (/^\s*\\\[\s*$/.test(line)) {
      displayMath = true;
      return line.replace(/\\\[/, () => "$$");
    }
    if (displayMath && /^\s*\\\]\s*$/.test(line)) {
      displayMath = false;
      return line.replace(/\\\]/, () => "$$");
    }
    if (displayMath) return line;
    return normalizeInlineTex(line);
  }).join("");
}

export function remarkWikiLinks() {
  return (tree: Root) => {
    visit(tree, "text", (node: Text, index, parent) => {
      if (index == null || !parent || ["link", "linkReference", "code", "inlineCode"].includes(parent.type)) return;
      const pattern = /\[\[([^\]|#]+)(#[^\]|]+)?(?:\|([^\]]+))?\]\]/g;
      const children: Array<Text | Link> = [];
      let cursor = 0;
      for (const match of node.value.matchAll(pattern)) {
        const start = match.index ?? 0;
        if (start > cursor) children.push({ type: "text", value: node.value.slice(cursor, start) });
        const target = match[1].trim();
        const hash = match[2] ?? "";
        const label = (match[3] ?? `${target}${hash}`).trim();
        children.push({ type: "link", url: `${target.endsWith(".md") ? target : `${target}.md`}${hash}`, children: [{ type: "text", value: label }] });
        cursor = start + match[0].length;
      }
      if (!children.length) return;
      if (cursor < node.value.length) children.push({ type: "text", value: node.value.slice(cursor) });
      parent.children.splice(index, 1, ...children);
      return index + children.length;
    });
  };
}

function plainText(nodes: PhrasingContent[]): string {
  return nodes.map((node) => {
    if (node.type === "text" || node.type === "inlineCode" || node.type === "inlineMath") return node.value;
    if ("children" in node) return plainText(node.children as PhrasingContent[]);
    return "";
  }).join("");
}

export function remarkHeadingIds() {
  return (tree: Root) => {
    const used = new Map<string, number>();
    visit(tree, "heading", (node: Heading) => {
      const id = slugify(plainText(node.children), used);
      node.data = { ...node.data, hProperties: { ...(node.data?.hProperties ?? {}), id } };
    });
  };
}

export function remarkCallouts() {
  return (tree: Root) => {
    visit(tree, "blockquote", (node: Blockquote) => {
      const paragraph = node.children[0] as Paragraph | undefined;
      const first = paragraph?.type === "paragraph" ? paragraph.children[0] : undefined;
      if (!first || first.type !== "text") return;
      const marker = /^\[!([A-Za-z]+)\][+-]?\s*/.exec(first.value);
      if (!marker) return;
      const kind = marker[1].toLowerCase();
      first.value = first.value.slice(marker[0].length);
      node.data = { ...node.data, hProperties: { ...(node.data?.hProperties ?? {}), "data-callout": kind } };
    });
  };
}

export function remarkSanitizeHtml() {
  return (tree: Root) => {
    visit(tree, "html", (node) => {
      node.value = DOMPurify.sanitize(node.value, {
        USE_PROFILES: { html: true },
        FORBID_TAGS: ["script", "style", "iframe", "object", "embed", "form"],
        FORBID_ATTR: ["style", "onerror", "onload", "onclick"]
      });
    });
  };
}
