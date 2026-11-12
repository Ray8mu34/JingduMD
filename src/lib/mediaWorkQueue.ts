// SVG decoding and diagram layout should yield to scrolling. Run one job per
// idle opportunity rather than starting every nearby diagram in the same frame.
type Job = { run: () => Promise<void>; signal: AbortSignal; resolve: () => void; reject: (error: unknown) => void; cancel: () => void };

export class MediaWorkQueue {
  private jobs: Job[] = [];
  private running = false;
  private timer: number | undefined;
  private idle: number | undefined;
  private lastScroll = -Infinity;
  private printing = false;
  private selecting = false;
  private disposed = false;

  constructor(private host: Window) {
    host.addEventListener("scroll", this.onScroll, { capture: true, passive: true });
    host.addEventListener("wheel", this.onScroll, { passive: true });
    host.addEventListener("touchmove", this.onScroll, { passive: true });
    host.addEventListener("pointerdown", this.onPointerDown, true);
    host.addEventListener("pointerup", this.onPointerUp, true);
    host.addEventListener("pointercancel", this.onPointerUp, true);
    host.addEventListener("blur", this.onPointerUp);
    host.addEventListener("jingreader:expand-for-print", this.onPrint);
    host.addEventListener("jingreader:restore-after-print", this.onRestore);
  }

  private onScroll = () => { this.lastScroll = this.host.performance.now(); };
  private onPointerDown = (event: PointerEvent) => {
    if (event.button !== 0 || !(event.target instanceof Element) || !event.target.closest(".reader-scroll,.markdown-body")) return;
    this.selecting = true;
    this.clearScheduled();
  };
  private onPointerUp = () => {
    if (!this.selecting) return;
    this.selecting = false;
    this.onScroll();
    this.schedule();
  };
  private onPrint = () => { this.printing = true; this.clearScheduled(); this.schedule(); };
  private onRestore = () => { this.printing = false; };

  enqueue(run: () => Promise<void>, signal: AbortSignal): Promise<void> {
    if (signal.aborted || this.disposed) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const job: Job = { run, signal, resolve, reject, cancel: () => {
        const index = this.jobs.indexOf(job);
        if (index < 0) return;
        this.jobs.splice(index, 1);
        signal.removeEventListener("abort", job.cancel);
        resolve();
        if (!this.jobs.length) this.clearScheduled();
      } };
      this.jobs.push(job);
      signal.addEventListener("abort", job.cancel, { once: true });
      this.schedule();
    });
  }

  private clearScheduled() {
    if (this.timer !== undefined) this.host.clearTimeout(this.timer);
    if (this.idle !== undefined) this.host.cancelIdleCallback(this.idle);
    this.timer = this.idle = undefined;
  }

  private schedule() {
    if (this.disposed || this.running || (!this.printing && this.selecting) || !this.jobs.length || this.timer !== undefined || this.idle !== undefined) return;
    const delay = this.printing ? 0 : Math.max(0, 160 - (this.host.performance.now() - this.lastScroll));
    if (delay > 0) {
      this.timer = this.host.setTimeout(() => { this.timer = undefined; this.schedule(); }, delay);
    } else if (!this.printing && typeof this.host.requestIdleCallback === "function") {
      this.idle = this.host.requestIdleCallback(() => { this.idle = undefined; this.start(); }, { timeout: 600 });
    } else {
      this.timer = this.host.setTimeout(() => { this.timer = undefined; this.start(); }, this.printing ? 0 : 32);
    }
  }

  private start() {
    // Scroll events can arrive after an idle callback was requested.
    if (!this.printing && (this.selecting || this.host.performance.now() - this.lastScroll < 160)) { this.schedule(); return; }
    const job = this.jobs.shift();
    if (!job) return;
    job.signal.removeEventListener("abort", job.cancel);
    this.running = true;
    Promise.resolve().then(() => { if (!job.signal.aborted) return job.run(); })
      .then(job.resolve, job.reject)
      .finally(() => { this.running = false; this.schedule(); });
  }

  dispose() {
    this.disposed = true;
    this.clearScheduled();
    for (const job of this.jobs.splice(0)) { job.signal.removeEventListener("abort", job.cancel); job.resolve(); }
    this.host.removeEventListener("scroll", this.onScroll, true);
    this.host.removeEventListener("wheel", this.onScroll);
    this.host.removeEventListener("touchmove", this.onScroll);
    this.host.removeEventListener("pointerdown", this.onPointerDown, true);
    this.host.removeEventListener("pointerup", this.onPointerUp, true);
    this.host.removeEventListener("pointercancel", this.onPointerUp, true);
    this.host.removeEventListener("blur", this.onPointerUp);
    this.host.removeEventListener("jingreader:expand-for-print", this.onPrint);
    this.host.removeEventListener("jingreader:restore-after-print", this.onRestore);
  }
}

const queue = new MediaWorkQueue(window);
export function scheduleMediaWork(run: () => Promise<void>, signal: AbortSignal) {
  return queue.enqueue(run, signal);
}

export function isSvgSource(source: string) {
  return /^data:image\/svg\+xml[;,]/i.test(source) || /\.svg(?:[?#]|$)/i.test(source);
}
