import { cachedMathHtml, rememberMathHtml, renderMathHtml } from "./mathRendering";
import { scheduleMediaWork } from "./mediaWorkQueue";

type Job = { id: number; source: string; display: boolean; signal: AbortSignal; resolve: (html: string | null) => void; cancel: () => void };

export class MathCompiler {
  private worker?: Worker;
  private failed = false;
  private serial = 0;
  private jobs: Job[] = [];
  private active?: Job;

  constructor(private createWorker: () => Worker = () => new Worker(new URL("./math.worker.ts", import.meta.url), { type: "module" })) {}

  render(source: string, display: boolean, signal: AbortSignal): Promise<string | null> {
    if (signal.aborted) return Promise.resolve(null);
    const cached = cachedMathHtml(source, display);
    if (cached !== undefined) return Promise.resolve(cached);
    return new Promise(resolve => {
      const job: Job = { id: ++this.serial, source, display, signal, resolve, cancel: () => {
        const index = this.jobs.indexOf(job);
        if (index >= 0) this.jobs.splice(index, 1);
        resolve(null);
      } };
      signal.addEventListener("abort", job.cancel, { once: true });
      this.jobs.push(job);
      this.pump();
    });
  }

  private finish(job: Job, html: string | null) {
    job.signal.removeEventListener("abort", job.cancel);
    job.resolve(job.signal.aborted ? null : html);
  }

  private fallback(job: Job) {
    // Worker startup can fail in a restricted WebView. The fallback still yields
    // to pointer selection and scrolling, rather than compiling inside React.
    let html: string | null = null;
    void scheduleMediaWork(async () => { html = renderMathHtml(job.source, job.display); }, job.signal)
      .then(() => this.finish(job, html), () => this.finish(job, null));
  }

  private failWorker = () => {
    this.failed = true;
    this.worker?.terminate();
    this.worker = undefined;
    const active = this.active;
    this.active = undefined;
    if (active) this.fallback(active);
    this.pump();
  };

  private pump() {
    if (this.active) return;
    while (this.jobs.length) {
      const job = this.jobs.shift()!;
      if (job.signal.aborted) { this.finish(job, null); continue; }
      const cached = cachedMathHtml(job.source, job.display);
      if (cached !== undefined) { this.finish(job, cached); continue; }
      if (this.failed || typeof Worker === "undefined") { this.fallback(job); continue; }
      if (!this.worker) {
        try {
          this.worker = this.createWorker();
          this.worker.addEventListener("error", this.failWorker);
          this.worker.addEventListener("messageerror", this.failWorker);
          this.worker.addEventListener("message", event => {
            const current = this.active;
            if (!current || event.data?.id !== current.id) return;
            this.active = undefined;
            if (typeof event.data.html === "string") {
              if (!current.signal.aborted) rememberMathHtml(current.source, current.display, event.data.html);
              this.finish(current, event.data.html);
            } else this.fallback(current);
            this.pump();
          });
        } catch { this.failed = true; this.fallback(job); continue; }
      }
      this.active = job;
      try { this.worker.postMessage({ id: job.id, source: job.source, display: job.display }); }
      catch { this.failWorker(); }
      return;
    }
  }
}

const compiler = new MathCompiler();
export const compileMath = (source: string, display: boolean, signal: AbortSignal) => compiler.render(source, display, signal);
