import "@testing-library/jest-dom/vitest";

class TestIntersectionObserver {
  constructor(private callback: IntersectionObserverCallback) {}
  observe(target: Element) {
    this.callback([{ isIntersecting: true, target } as IntersectionObserverEntry], this as unknown as IntersectionObserver);
  }
  disconnect() {}
  unobserve() {}
}

Object.defineProperty(globalThis, "IntersectionObserver", { value: TestIntersectionObserver, writable: true });
Object.defineProperty(URL, "createObjectURL", { value: () => "blob:jingreader-test", writable: true });
Object.defineProperty(URL, "revokeObjectURL", { value: () => undefined, writable: true });
