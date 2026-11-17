import { describe, expect, it, vi } from "vitest";
import katex from "katex";
import { renderMathHtml } from "./mathRendering";

describe("bounded visual math cache", () => {
  it("reuses repeated formulas while keeping inline and display layout separate", () => {
    const render = vi.spyOn(katex, "renderToString");
    try {
      const source = String.raw`\frac{2026}{113}`;
      const inline = renderMathHtml(source, false);
      expect(renderMathHtml(source, false)).toBe(inline);
      expect(render).toHaveBeenCalledTimes(1);
      const display = renderMathHtml(source, true);
      expect(display).toContain("katex-display");
      expect(inline).not.toContain("katex-mathml");
      expect(display).not.toContain("<math");
      expect(render).toHaveBeenCalledTimes(2);
    } finally { render.mockRestore(); }
  });

  it("does not retain an oversized formula result", () => {
    const render = vi.spyOn(katex, "renderToString").mockReturnValue("x".repeat(3 * 1024 * 1024));
    try {
      renderMathHtml("oversized-cache-entry", false);
      renderMathHtml("oversized-cache-entry", false);
      expect(render).toHaveBeenCalledTimes(2);
    } finally { render.mockRestore(); }
  });
});
