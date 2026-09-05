import { fireEvent, render, waitFor } from "@testing-library/react";
import FileTree from "./FileTree";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn((command: string) => {
    if (command === "list_directory") return Promise.resolve([{ name: "第一章.md", path: "C:\\notes\\第一章.md", kind: "markdown", hasChildren: false }]);
    if (command === "load_expanded_paths") return Promise.resolve([]);
    return Promise.resolve(undefined);
  })
}));

describe("FileTree multi-window actions", () => {
  it("offers a themed context action and Ctrl shortcuts for a new window", async () => {
    const onOpen = vi.fn();
    const onOpenNew = vi.fn();
    const { getByRole, getByText } = render(<div className="app"><FileTree root="C:\\notes" selected={null} onOpen={onOpen} onOpenNew={onOpenNew} /></div>);
    await waitFor(() => expect(getByText("第一章.md")).toBeInTheDocument());
    const row = getByText("第一章.md").closest("button")!;
    fireEvent.contextMenu(row, { clientX: 80, clientY: 90 });
    fireEvent.click(getByRole("menuitem", { name: "在新窗口打开" }));
    expect(onOpenNew).toHaveBeenCalledWith("C:\\notes\\第一章.md");
    fireEvent.keyDown(row, { key: "Enter", ctrlKey: true });
    expect(onOpenNew).toHaveBeenCalledTimes(2);
    expect(onOpen).not.toHaveBeenCalled();
  });
});
