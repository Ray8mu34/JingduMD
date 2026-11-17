import { renderMathHtml } from "./mathRendering";

self.onmessage = (event: MessageEvent<{ id: number; source: string; display: boolean }>) => {
  const { id, source, display } = event.data;
  try { self.postMessage({ id, html: renderMathHtml(source, display) }); }
  catch (error) { self.postMessage({ id, error: String(error) }); }
};
