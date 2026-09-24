import type { KeyboardEvent } from "react";

export function handleMenuKeys(event: KeyboardEvent<HTMLElement>, close: (reason: "escape" | "tab") => void): void {
  const items = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)')];
  const index = items.indexOf(document.activeElement as HTMLButtonElement);
  if (event.key === "Escape") {
    event.preventDefault(); event.stopPropagation(); close("escape"); return;
  }
  if (event.key === "Tab") {
    window.setTimeout(() => close("tab"), 0); return;
  }
  const next = event.key === "ArrowDown" ? (index + 1) % items.length
    : event.key === "ArrowUp" ? (index - 1 + items.length) % items.length
      : event.key === "Home" ? 0 : event.key === "End" ? items.length - 1 : -1;
  if (next >= 0 && items.length) { event.preventDefault(); event.stopPropagation(); items[next].focus(); }
}

export function trapTab(event: KeyboardEvent<HTMLElement>): void {
  if (event.key !== "Tab") return;
  const items = [...event.currentTarget.querySelectorAll<HTMLElement>("button:not(:disabled), input:not(:disabled), select:not(:disabled), summary, a[href]")]
    .filter((item) => item.getClientRects().length > 0);
  if (!items.length) return;
  const first = items[0];
  const last = items[items.length - 1];
  if (event.shiftKey && (document.activeElement === first || !event.currentTarget.contains(document.activeElement))) {
    event.preventDefault(); last.focus();
  } else if (!event.shiftKey && (document.activeElement === last || !event.currentTarget.contains(document.activeElement))) {
    event.preventDefault(); first.focus();
  }
}
