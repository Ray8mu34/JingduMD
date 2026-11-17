type Reveal = (printing: boolean) => void;
type Group = { observer: IntersectionObserver; targets: Map<Element, () => void> };
const groups = new Map<string, Group>();
const printSubscribers = new Set<Reveal>();

// A book can contain thousands of formulas. Share observers and print handlers
// instead of allocating one observer and two window listeners per formula.
window.addEventListener("jingreader:expand-for-print", () => {
  // Print reveals all subscribed content permanently; observing those targets
  // afterward would keep doing thousands of intersection tests on every scroll.
  for (const group of groups.values()) { group.observer.disconnect(); group.targets.clear(); }
  groups.clear();
  for (const reveal of printSubscribers) reveal(true);
});
window.addEventListener("jingreader:restore-after-print", () => {
  for (const reveal of printSubscribers) reveal(false);
});

export function observeContent(target: Element, margin: string, reveal: () => void) {
  let group = groups.get(margin);
  if (!group) {
    const targets = new Map<Element, () => void>();
    const observer = new IntersectionObserver(entries => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        const callback = targets.get(entry.target);
        targets.delete(entry.target);
        observer.unobserve(entry.target);
        callback?.();
      }
    }, { rootMargin: margin });
    group = { observer, targets };
    groups.set(margin, group);
  }
  const current = group;
  current.targets.set(target, reveal);
  current.observer.observe(target);
  return () => {
    current.targets.delete(target);
    current.observer.unobserve(target);
    if (!current.targets.size) {
      current.observer.disconnect();
      if (groups.get(margin) === current) groups.delete(margin);
    }
  };
}

export function subscribeContentPrint(reveal: Reveal) {
  printSubscribers.add(reveal);
  return () => { printSubscribers.delete(reveal); };
}
