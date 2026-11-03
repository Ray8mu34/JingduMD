import { describe, expect, it } from "vitest";
import { findSource, sourceForSave, sourceText } from "./sourceEditing";

describe("source line endings", () => {
  it("normalizes input but returns every untouched original exactly", () => {
    for (const original of ["a\r\nb\r\n", "a\rb\r", "a\nb\n", "a\r\nb\rc\n", "无换行"]) {
      expect(sourceForSave(sourceText(original), original)).toBe(original);
    }
  });
  it("retains uniform CRLF or CR and normalizes mixed endings only on change", () => {
    expect(sourceForSave("a\nb!\n", "a\r\nb\r\n")).toBe("a\r\nb!\r\n");
    expect(sourceForSave("a\nb!\n", "a\rb\r")).toBe("a\rb!\r");
    expect(sourceForSave("a\nb!\nc\n", "a\r\nb\rc\n")).toBe("a\nb!\nc\n");
    expect(sourceForSave("原文\n新增", "原文")).toBe("原文\n新增");
  });
});

it("finds literal source syntax and wraps using original Unicode offsets", () => {
  const text = "İ **A** 😀 **a**";
  expect(findSource(text, "**a**", 0, 0, 1)).toEqual({ start: 2, end: 7 });
  const last = text.lastIndexOf("**a**");
  expect(findSource(text, "**a**", 2, 7, 1)).toEqual({ start: last, end: last + 5 });
  expect(findSource(text, "**a**", 2, 7, -1)).toEqual({ start: last, end: last + 5 });
  expect(findSource(text, "missing", 0, 0, 1)).toBeNull();
  expect(findSource(text, "", 0, 0, -1)).toBeNull();
});
