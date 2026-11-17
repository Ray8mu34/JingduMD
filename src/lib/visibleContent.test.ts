import { describe, expect, it, vi } from "vitest";
import { observeContent, subscribeContentPrint } from "./visibleContent";

describe("shared content observation", () => {
  it("uses one observer for a batch and only reveals intersecting targets once", () => {
    let notify!: IntersectionObserverCallback;
    const unobserve = vi.fn(), disconnect = vi.fn();
    const constructor = vi.fn(function (callback: IntersectionObserverCallback) {
      notify = callback;
      return { observe: vi.fn(), unobserve, disconnect };
    });
    const original = globalThis.IntersectionObserver;
    globalThis.IntersectionObserver = constructor as unknown as typeof IntersectionObserver;
    try {
      const first = document.createElement("span"), second = document.createElement("span");
      const one = vi.fn(), two = vi.fn();
      const offOne = observeContent(first, "123px", one);
      const offTwo = observeContent(second, "123px", two);
      expect(constructor).toHaveBeenCalledOnce();
      notify([{ target: first, isIntersecting: false }, { target: second, isIntersecting: true }] as unknown as IntersectionObserverEntry[], {} as IntersectionObserver);
      expect(one).not.toHaveBeenCalled();
      expect(two).toHaveBeenCalledOnce();
      notify([{ target: second, isIntersecting: true }] as unknown as IntersectionObserverEntry[], {} as IntersectionObserver);
      expect(two).toHaveBeenCalledOnce();
      offOne(); offTwo();
      expect(disconnect).toHaveBeenCalled();
    } finally { globalThis.IntersectionObserver = original; }
  });

  it("unsubscribes closed content from print preparation and restoration", () => {
    const reveal = vi.fn();
    const off = subscribeContentPrint(reveal);
    window.dispatchEvent(new Event("jingreader:expand-for-print"));
    window.dispatchEvent(new Event("jingreader:restore-after-print"));
    expect(reveal.mock.calls).toEqual([[true], [false]]);
    off();
    window.dispatchEvent(new Event("jingreader:expand-for-print"));
    expect(reveal).toHaveBeenCalledTimes(2);
  });
});
