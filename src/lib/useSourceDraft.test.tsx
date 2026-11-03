import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { invoke as TauriInvoke } from "@tauri-apps/api/core";
import { useSourceDraft } from "./useSourceDraft";
import type { DocumentPayload } from "../types";

const document: DocumentPayload = { path: "C:\\notes\\a.md", name: "a.md", content: "原文\r\n", revision: "v1", size: 8, modifiedMs: 1 };
async function setup() {
  let disk = { ...document };
  let fail = false;
  const invoke = vi.fn(async (command: string, args?: Record<string, unknown>) => {
    if (command === "read_document") return { ...disk };
    if (fail || args?.revision !== disk.revision) throw new Error("外部冲突或写入失败");
    disk = { ...disk, content: String(args?.content), revision: "v2" };
    return { ...disk };
  });
  const saved = vi.fn();
  const hook = renderHook(() => useSourceDraft(invoke as typeof TauriInvoke, saved));
  await act(async () => hook.result.current.begin(document));
  return { hook, invoke, saved, fail: () => { fail = true; }, external: () => { disk = { ...disk, content: "外部修改", revision: "external" }; } };
}
describe("private source draft", () => {
  it("does not write untouched input and advances the saved baseline without resetting text", async () => {
    const { hook, invoke, saved } = await setup();
    await act(async () => { expect(await hook.result.current.save()).toBe(true); });
    expect(invoke.mock.calls.some(([command]) => command === "save_document")).toBe(false);
    act(() => hook.result.current.change("修改\n"));
    expect(saved).not.toHaveBeenCalled();
    await act(async () => { expect(await hook.result.current.save()).toBe(true); });
    expect(hook.result.current.dirty).toBe(false);
    expect(hook.result.current.draft?.text).toBe("修改\n");
    expect(saved.mock.calls[0][0].content).toBe("修改\r\n");
    // Native undo after saving changes the draft again against the new baseline.
    act(() => hook.result.current.change("原文\n"));
    expect(hook.result.current.dirty).toBe(true);
  });
  it("lets only the first pending navigation own the dialog approval", async () => {
    const { hook } = await setup();
    act(() => hook.result.current.change("草稿"));
    let first!: Promise<boolean>;
    act(() => { first = hook.result.current.leave(); });
    expect(hook.result.current.asking).toBe(true);
    expect(await hook.result.current.leave()).toBe(false);
    act(() => hook.result.current.cancel());
    expect(await first).toBe(false);
    expect(hook.result.current.draft?.text).toBe("草稿");
    act(() => { first = hook.result.current.leave(); });
    act(() => hook.result.current.discard());
    expect(await first).toBe(true);
    expect(hook.result.current.draft).toBe(null);
  });
  it("retains input and the pending dialog on failed save or external change", async () => {
    const { hook, external, fail } = await setup();
    act(() => hook.result.current.change("私人输入"));
    external();
    await act(async () => { await hook.result.current.checkExternal(); });
    expect(hook.result.current.draft?.text).toBe("私人输入");
    expect(hook.result.current.draft?.external).toBe(true);
    act(() => { void hook.result.current.leave(); });
    fail();
    await act(async () => { await hook.result.current.saveAndLeave(); });
    expect(hook.result.current.asking).toBe(true);
    expect(hook.result.current.draft?.error).toContain("输入已保留");
    await waitFor(() => expect(hook.result.current.draft?.busy).toBe(false));
    expect(hook.result.current.draft?.text).toBe("私人输入");
  });
});
