import { forwardRef, useEffect, useRef, useState, type ReactNode } from "react";
import { SIDEBAR_DEFAULTS, SIDEBAR_MIN } from "../lib/sidebarSizing";

type Props = {
  side: "left" | "right";
  width: number;
  maxWidth: number;
  overlay: boolean;
  onResize: (width: number) => void;
  children: ReactNode;
};

const ResizableSidebar = forwardRef<HTMLElement, Props>(function ResizableSidebar({ side, width, maxWidth, overlay, onResize, children }, ref) {
  const drag = useRef<{ pointerId: number; x: number; width: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  const label = side === "left" ? "文件栏宽度" : "大纲栏宽度";
  const direction = side === "left" ? 1 : -1;
  const resize = (next: number) => onResize(Math.round(Math.max(SIDEBAR_MIN, Math.min(maxWidth, next))));
  const stop = () => { drag.current = null; setDragging(false); };

  useEffect(() => {
    if (!dragging) return;
    document.documentElement.classList.add("resizing-sidebar");
    window.addEventListener("blur", stop);
    return () => {
      document.documentElement.classList.remove("resizing-sidebar");
      window.removeEventListener("blur", stop);
    };
  }, [dragging]);

  return <aside ref={ref} className={`${side}-sidebar ${overlay ? "overlay-sidebar" : ""}`} style={{ width }}>
    <div className="sidebar-content" id={`${side}-sidebar-content`}>{children}</div>
    <div className={`sidebar-resizer ${dragging ? "is-dragging" : ""}`} role="separator" tabIndex={0}
      aria-label={label} aria-orientation="vertical" aria-valuemin={SIDEBAR_MIN} aria-valuemax={maxWidth} aria-valuenow={width} aria-valuetext={`${width} 像素`}
      aria-controls={`${side}-sidebar-content`} title="拖动调整宽度；双击恢复默认；方向键微调"
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        event.preventDefault();
        event.currentTarget.focus();
        event.currentTarget.setPointerCapture(event.pointerId);
        drag.current = { pointerId: event.pointerId, x: event.clientX, width };
        setDragging(true);
      }}
      onPointerMove={(event) => {
        const start = drag.current;
        if (start && start.pointerId === event.pointerId) resize(start.width + (event.clientX - start.x) * direction);
      }}
      onPointerUp={(event) => {
        if (drag.current?.pointerId !== event.pointerId) return;
        stop();
        if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
      }}
      onPointerCancel={stop} onLostPointerCapture={stop}
      onDoubleClick={() => resize(SIDEBAR_DEFAULTS[side])}
      onKeyDown={(event) => {
        const step = event.shiftKey ? 30 : 10;
        const next = event.key === "ArrowLeft" ? width - step * direction
          : event.key === "ArrowRight" ? width + step * direction
          : event.key === "Home" ? SIDEBAR_MIN : event.key === "End" ? maxWidth : null;
        if (next === null) return;
        event.preventDefault();
        resize(next);
      }} />
  </aside>;
});

export default ResizableSidebar;
