import { useEffect, type RefObject } from "react";

const portalOwners = new WeakMap<EventTarget, HTMLElement>();

// Portaled menus remain part of their trigger's surface for outside dismissal.
export function registerDismissPortal(portal: HTMLElement, owner: HTMLElement): () => void {
  portalOwners.set(portal, owner);
  return () => { portalOwners.delete(portal); };
}

export function useOutsideDismiss(active: boolean, inside: RefObject<HTMLElement>[], dismiss: () => void, blur = false): void {
  useEffect(() => {
    if (!active) return;
    const outside = (event: PointerEvent) => {
      const path = event.composedPath();
      if (inside.some((ref) => ref.current && (path.includes(ref.current) || path.some((part) => {
        const owner = portalOwners.get(part);
        return owner && ref.current!.contains(owner);
      })))) return;
      dismiss();
    };
    const windowBlur = () => dismiss();
    document.addEventListener("pointerdown", outside, true);
    if (blur) window.addEventListener("blur", windowBlur);
    return () => { document.removeEventListener("pointerdown", outside, true); if (blur) window.removeEventListener("blur", windowBlur); };
  }, [active, blur, dismiss, inside]);
}
