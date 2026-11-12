import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isSvgSource, MediaWorkQueue } from "./mediaWorkQueue";

describe("media work scheduling", () => {
  let queue: MediaWorkQueue;
  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(window.performance, "now").mockImplementation(() => Date.now());
    queue = new MediaWorkQueue(window);
  });
  afterEach(() => { queue.dispose(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });

  it("waits for scrolling to settle, including scrolls inside the reader", async () => {
    const run = vi.fn(async () => {});
    const reader = document.createElement("div");
    document.body.append(reader);
    void queue.enqueue(run, new AbortController().signal);
    for (let index = 0; index < 6; index++) {
      reader.dispatchEvent(new Event("scroll"));
      await vi.advanceTimersByTimeAsync(80);
      expect(run).not.toHaveBeenCalled();
    }
    await vi.advanceTimersByTimeAsync(150);
    expect(run).toHaveBeenCalledOnce();
    reader.remove();
  });

  it("does not start the next image until the previous job finishes", async () => {
    let finish!: () => void;
    const first = queue.enqueue(() => new Promise<void>(resolve => { finish = resolve; }), new AbortController().signal);
    const next = vi.fn(async () => {});
    const second = queue.enqueue(next, new AbortController().signal);
    await vi.advanceTimersByTimeAsync(1000);
    expect(next).not.toHaveBeenCalled();
    finish();
    await first;
    await vi.advanceTimersByTimeAsync(40);
    await second;
    expect(next).toHaveBeenCalledOnce();
  });

  it("does not start media work while the reader has an active pointer selection", async () => {
    const reader = document.createElement("div");
    reader.className = "reader-scroll";
    document.body.append(reader);
    reader.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, button: 0 }));
    const run = vi.fn(async () => {});
    void queue.enqueue(run, new AbortController().signal);
    await vi.advanceTimersByTimeAsync(2000);
    expect(run).not.toHaveBeenCalled();
    window.dispatchEvent(new Event("pointerup"));
    await vi.advanceTimersByTimeAsync(100);
    expect(run).not.toHaveBeenCalled();
    await vi.runAllTimersAsync();
    expect(run).toHaveBeenCalledOnce();
    reader.remove();
  });

  it("drops cancelled jobs and continues after a failed image", async () => {
    const controller = new AbortController();
    const stale = vi.fn(async () => {});
    const cancelled = queue.enqueue(stale, controller.signal);
    controller.abort();
    await cancelled;
    const failure = queue.enqueue(async () => { throw new Error("bad SVG"); }, new AbortController().signal);
    const handled = expect(failure).rejects.toThrow("bad SVG");
    const next = vi.fn(async () => {});
    const done = queue.enqueue(next, new AbortController().signal);
    await vi.runAllTimersAsync();
    await handled;
    await done;
    expect(stale).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledOnce();
  });

  it("rechecks scrolling when an idle callback fires", async () => {
    vi.stubGlobal("requestIdleCallback", (callback: () => void) => window.setTimeout(callback, 50));
    vi.stubGlobal("cancelIdleCallback", (id: number) => window.clearTimeout(id));
    const run = vi.fn(async () => {});
    void queue.enqueue(run, new AbortController().signal);
    await vi.advanceTimersByTimeAsync(40);
    window.dispatchEvent(new Event("wheel"));
    await vi.advanceTimersByTimeAsync(100);
    expect(run).not.toHaveBeenCalled();
    await vi.runAllTimersAsync();
    expect(run).toHaveBeenCalledOnce();
  });

  it("bypasses scroll deferral for printing and restores it afterward", async () => {
    const run = vi.fn(async () => {});
    window.dispatchEvent(new Event("wheel"));
    void queue.enqueue(run, new AbortController().signal);
    window.dispatchEvent(new Event("jingreader:expand-for-print"));
    await vi.advanceTimersByTimeAsync(1);
    expect(run).toHaveBeenCalledOnce();
    window.dispatchEvent(new Event("jingreader:restore-after-print"));
    const next = vi.fn(async () => {});
    void queue.enqueue(next, new AbortController().signal);
    await vi.advanceTimersByTimeAsync(100);
    expect(next).not.toHaveBeenCalled();
    await vi.runAllTimersAsync();
    expect(next).toHaveBeenCalledOnce();
  });

  it("recognizes SVG files and notebook data URLs", () => {
    expect(isSvgSource("../images/Plot.SVG?version=2#view")).toBe(true);
    expect(isSvgSource("data:image/svg+xml;base64,PHN2Zy8+")).toBe(true);
    expect(isSvgSource("data:image/svg+xml,%3Csvg/%3E")).toBe(true);
    expect(isSvgSource("picture.png")).toBe(false);
  });
});
