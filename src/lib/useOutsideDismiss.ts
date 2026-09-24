import { useEffect, type RefObject } from "react";

export function useOutsideDismiss(active: boolean, inside: RefObject<HTMLElement>[], dismiss: () => void, blur = false): void {
  useEffect(() => {
    if (!active) return;
    const outside = (event: PointerEvent) => {
      const path = event.composedPath();
      if (inside.some((ref) => ref.current && path.includes(ref.current))) return;
      dismiss();
    };
    const windowBlur = () => dismiss();
    document.addEventListener("pointerdown", outside, true);
    if (blur) window.addEventListener("blur", windowBlur);
    return () => { document.removeEventListener("pointerdown", outside, true); if (blur) window.removeEventListener("blur", windowBlur); };
  }, [active, blur, dismiss, inside]);
}
