import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import AnnotationManager from "./AnnotationManager";

const { invoke, open } = vi.hoisted(() => ({ invoke: vi.fn(), open: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async () => () => {}) }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open }));
afterEach(cleanup);
beforeEach(() => {
  vi.clearAllMocks();
  invoke.mockImplementation(async (command) => {
    if (command === "annotation_library") return [{ id: "old", path: "C:\\old\\文章.md", missing: true, hasFingerprint: false, active: 1, deleted: 1, preview: "仍然保留的摘录" }];
    if (command === "managed_highlights") return [{ id: 1, quote: "仍然保留的摘录", color: "green" }];
    return null;
  });
});
describe("annotation recovery manager", () => {
  it("shows legacy excerpts and requires an explicit target before reassociation", async () => {
    open.mockResolvedValue("C:\\new\\文章.md");
    render(<AnnotationManager root="C:\\new" onClose={() => {}} onChooseFolder={() => {}} />);
    await screen.findByText(/旧记录没有内容指纹/);
    fireEvent.click(screen.getByRole("button", { name: "选择对应文件" }));
    await screen.findByRole("button", { name: "确认关联" });
    expect(invoke.mock.calls.some(([command]) => command === "relink_highlights")).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "确认关联" }));
    await waitFor(() => expect(invoke).toHaveBeenCalledWith("relink_highlights", { documentId: "old", path: "C:\\new\\文章.md" }));
  });
  it("offers recovery and a separate confirmation for permanent deletion", async () => {
    render(<AnnotationManager root="C:\\new" onClose={() => {}} onChooseFolder={() => {}} />);
    await screen.findByText(/旧记录没有内容指纹/);
    fireEvent.click(screen.getByRole("tab", { name: /回收站/ }));
    fireEvent.click(await screen.findByRole("button", { name: "恢复这一条" }));
    await waitFor(() => expect(invoke).toHaveBeenCalledWith("restore_highlight", { id: 1 }));
    await waitFor(() => expect(screen.getByRole("button", { name: "永久删除" })).not.toBeDisabled());
    fireEvent.click(screen.getByRole("button", { name: "永久删除" }));
    expect(invoke.mock.calls.some(([command]) => command === "manage_annotation_document")).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "确认永久删除" }));
    await waitFor(() => expect(invoke).toHaveBeenCalledWith("manage_annotation_document", { documentId: "old", action: "purge" }));
  });
  it("supports backups without an open folder and handles cancelling import", async () => {
    render(<AnnotationManager root="" onClose={() => {}} onChooseFolder={() => {}} />);
    expect(screen.getByRole("button", { name: "扫描找回" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "导入备份" }));
    await waitFor(() => expect(invoke).toHaveBeenCalledWith("import_annotations"));
    await waitFor(() => expect(screen.getByRole("button", { name: "导出备份" })).not.toBeDisabled());
    expect(screen.queryByText(/已导入/)).toBeNull();
  });
});
