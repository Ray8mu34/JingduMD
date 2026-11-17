import { describe, expect, it, vi } from "vitest";
import { MathCompiler } from "./mathCompiler";

class FakeWorker extends EventTarget {
  messages: { id: number; source: string; display: boolean }[] = [];
  postMessage(message: typeof this.messages[number]) { this.messages.push(message); }
  terminate = vi.fn();
  reply(html: string) { this.dispatchEvent(new MessageEvent("message", { data: { id: this.messages.at(-1)!.id, html } })); }
}

describe("background formula compiler", () => {
  it("serializes work, drops cancelled waiting jobs and shares cached results", async () => {
    vi.stubGlobal("Worker", FakeWorker);
    try {
      const worker = new FakeWorker();
      const compiler = new MathCompiler(() => worker as unknown as Worker);
      const first = compiler.render("worker-first", false, new AbortController().signal);
      const controller = new AbortController();
      const cancelled = compiler.render("worker-cancelled", false, controller.signal);
      const repeat = compiler.render("worker-first", false, new AbortController().signal);
      controller.abort();
      expect(await cancelled).toBeNull();
      expect(worker.messages).toHaveLength(1);
      worker.reply("<span>first</span>");
      expect(await first).toBe("<span>first</span>");
      expect(await repeat).toBe("<span>first</span>");
      expect(worker.messages).toHaveLength(1);
    } finally { vi.unstubAllGlobals(); }
  });

  it("does not publish an in-flight result after its document closes", async () => {
    vi.stubGlobal("Worker", FakeWorker);
    try {
      const worker = new FakeWorker();
      const compiler = new MathCompiler(() => worker as unknown as Worker);
      const controller = new AbortController();
      const pending = compiler.render("worker-stale", false, controller.signal);
      controller.abort();
      expect(await pending).toBeNull();
      const next = compiler.render("worker-next", true, new AbortController().signal);
      worker.reply("stale");
      expect(worker.messages.at(-1)?.source).toBe("worker-next");
      worker.reply("next");
      expect(await next).toBe("next");
    } finally { vi.unstubAllGlobals(); }
  });

  it("falls back to deferred rendering when the worker fails to start", async () => {
    vi.stubGlobal("Worker", FakeWorker);
    try {
      const compiler = new MathCompiler(() => { throw new Error("worker blocked"); });
      const result = await compiler.render("fallback^2", false, new AbortController().signal);
      expect(result).toContain('class="katex"');
    } finally { vi.unstubAllGlobals(); }
  });
  it("recovers active and waiting formulas when a running worker fails", async () => {
    vi.stubGlobal("Worker", FakeWorker);
    try {
      const worker = new FakeWorker();
      const compiler = new MathCompiler(() => worker as unknown as Worker);
      const active = compiler.render("runtimeFallback^2", false, new AbortController().signal);
      const waiting = compiler.render("runtimeNext^2", true, new AbortController().signal);
      worker.dispatchEvent(new Event("error"));
      expect(worker.terminate).toHaveBeenCalledOnce();
      expect(await active).toContain('class="katex"');
      expect(await waiting).toContain("katex-display");
    } finally { vi.unstubAllGlobals(); }
  });
});
