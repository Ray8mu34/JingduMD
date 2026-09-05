import { expect, it } from "vitest";
import { isMacPlatform, primaryModifier, shortcutLabel } from "./platform";

it("uses Command on Mac and Control on Windows", () => {
  expect(isMacPlatform("MacIntel")).toBe(true);
  expect(isMacPlatform("Win32")).toBe(false);
  expect(primaryModifier({ ctrlKey: false, metaKey: true }, true)).toBe(true);
  expect(primaryModifier({ ctrlKey: true, metaKey: false }, true)).toBe(false);
  expect(primaryModifier({ ctrlKey: true, metaKey: false }, false)).toBe(true);
  expect(shortcutLabel("Ctrl+Shift+D", true)).toBe("⌘+⇧+D");
});
