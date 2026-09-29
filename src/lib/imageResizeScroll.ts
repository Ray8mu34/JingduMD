const activeHolds = new WeakMap<HTMLElement, () => void>();

/** Manual image resizing owns scroll position until layout observers have settled. */
export function holdImageResizeScroll(image: HTMLElement) {
  const container = image.closest<HTMLElement>(".reader-scroll");
  if (!container) return { stabilize() {}, finish() {} };
  activeHolds.get(container)?.();
  const top = container.scrollTop;
  const previous = container.style.overflowAnchor;
  container.dataset.imageResizing = "true";
  container.style.overflowAnchor = "none";
  container.dispatchEvent(new Event("jingreader:image-resize-start"));
  const stabilize = () => { container.scrollTop = top; };
  const release = () => {
    if (activeHolds.get(container) !== release) return;
    stabilize();
    delete container.dataset.imageResizing;
    container.style.overflowAnchor = previous;
    activeHolds.delete(container);
    container.dispatchEvent(new Event("jingreader:image-resize-end"));
  };
  activeHolds.set(container, release);
  let finished = false;
  return {
    stabilize,
    finish() {
      if (finished) return;
      finished = true;
      // Keep both native anchoring and the article observer paused through the final paint.
      requestAnimationFrame(() => requestAnimationFrame(release));
    }
  };
}
