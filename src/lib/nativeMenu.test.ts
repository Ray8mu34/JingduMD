import { act, renderHook, waitFor } from "@testing-library/react";
import { useNativeMenu } from "./nativeMenu";

const mocks = vi.hoisted(() => ({ listen: vi.fn(), unlisten: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => true }));
vi.mock("./platform", () => ({ isMac: true }));
vi.mock("@tauri-apps/api/event", () => ({ listen: mocks.listen }));

beforeEach(() => { vi.clearAllMocks(); });

it("uses current document actions without repeatedly registering native listeners", async () => {
  let receive!: (event: { payload: string }) => void;
  mocks.listen.mockImplementation((_name, callback) => { receive = callback; return Promise.resolve(mocks.unlisten); });
  const first = vi.fn();
  const latest = vi.fn();
  const { rerender, unmount } = renderHook(({ handler }) => useNativeMenu(handler), { initialProps: { handler: first } });
  rerender({ handler: latest });
  act(() => receive({ payload: "reader-export-pdf" }));
  expect(first).not.toHaveBeenCalled();
  expect(latest).toHaveBeenCalledWith("reader-export-pdf");
  expect(mocks.listen).toHaveBeenCalledTimes(1);
  unmount();
  await waitFor(() => expect(mocks.unlisten).toHaveBeenCalledTimes(1));
  receive({ payload: "reader-find" });
  expect(latest).toHaveBeenCalledTimes(1);
});

it("removes a listener that finishes registering after unmount", async () => {
  let registered!: (unlisten: () => void) => void;
  mocks.listen.mockReturnValue(new Promise<() => void>((resolve) => { registered = resolve; }));
  const { unmount } = renderHook(() => useNativeMenu(vi.fn()));
  unmount();
  registered(mocks.unlisten);
  await waitFor(() => expect(mocks.unlisten).toHaveBeenCalledTimes(1));
});
