import { fireEvent, render, waitFor } from "@testing-library/react";
import FileTree from "./FileTree";

vi.mock("../lib/platform", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/platform")>();
  return { ...actual, isMac: true,
    primaryModifier: (event: { ctrlKey: boolean; metaKey: boolean }) => actual.primaryModifier(event, true),
    shortcutLabel: (label: string) => actual.shortcutLabel(label, true) };
});
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn((command: string) => {
  if (command === "list_directory") return Promise.resolve([{ name: "第一章.md", path: "/Users/me/资料/第一章.md", kind: "markdown", hasChildren: false }]);
  return Promise.resolve([]);
}) }));

it("opens a comparison window with Command+Enter and Command+double-click on Mac", async () => {
  const onOpen = vi.fn();
  const onOpenNew = vi.fn();
  const { getByText, getByRole } = render(<FileTree root="/Users/me/资料" selected={null} onOpen={onOpen} onOpenNew={onOpenNew} onSearch={vi.fn()} />);
  await waitFor(() => expect(getByText("第一章.md")).toBeInTheDocument());
  const row = getByText("第一章.md").closest("button")!;
  expect(row.title).toContain("⌘+Enter");
  expect(getByRole("button", { name: "搜索文件夹" })).toHaveAttribute("title", "搜索文件夹 (⌘+P)");
  fireEvent.keyDown(row, { key: "Enter", ctrlKey: true });
  expect(onOpenNew).not.toHaveBeenCalled();
  fireEvent.keyDown(row, { key: "Enter", metaKey: true });
  fireEvent.doubleClick(row, { metaKey: true });
  expect(onOpenNew).toHaveBeenCalledTimes(2);
  expect(onOpenNew).toHaveBeenCalledWith("/Users/me/资料/第一章.md");
  expect(onOpen).not.toHaveBeenCalled();
});
