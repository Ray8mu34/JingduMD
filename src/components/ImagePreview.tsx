import { useLayoutEffect, useRef, useState } from "react";
import { Scan, X, ZoomIn, ZoomOut } from "lucide-react";

export default function ImagePreview({ src, alt, onClose }: { src: string; alt: string; onClose: () => void }) {
  const stage = useRef<HTMLDivElement>(null);
  const image = useRef<HTMLImageElement>(null);
  const [natural, setNatural] = useState({ width: 0, height: 0 });
  const [viewport, setViewport] = useState({ width: 0, height: 0 });
  const [scale, setScale] = useState(1);
  const [fitting, setFitting] = useState(true);
  const focal = useRef<{ x: number; y: number; screenX: number; screenY: number } | null>(null);
  const drag = useRef<{ x: number; y: number; left: number; top: number } | null>(null);
  const fit = natural.width && viewport.width ? Math.min(1, Math.max(1, viewport.width - 32) / natural.width, Math.max(1, viewport.height - 32) / natural.height) : 1;
  const actual = fitting ? fit : scale;
  const width = natural.width * actual;
  const height = natural.height * actual;
  const canvasWidth = Math.max(viewport.width, width + 32);
  const canvasHeight = Math.max(viewport.height, height + 32);
  useLayoutEffect(() => {
    const element = stage.current;
    if (!element) return;
    const measure = () => setViewport({ width: element.clientWidth, height: element.clientHeight });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const zoom = (next: number, clientX?: number, clientY?: number) => {
    const element = stage.current;
    const img = image.current;
    if (!element || !img) return;
    const bounds = element.getBoundingClientRect();
    const rect = img.getBoundingClientRect();
    const x = clientX ?? bounds.left + element.clientWidth / 2;
    const y = clientY ?? bounds.top + element.clientHeight / 2;
    focal.current = { x: (x - rect.left) / Math.max(1, rect.width), y: (y - rect.top) / Math.max(1, rect.height), screenX: x - bounds.left, screenY: y - bounds.top };
    setFitting(false);
    setScale(Math.max(.01, Math.min(8, next)));
  };
  useLayoutEffect(() => {
    const element = stage.current;
    if (!element) return;
    const point = focal.current;
    if (fitting) { element.scrollLeft = 0; element.scrollTop = 0; }
    else if (point) {
      element.scrollLeft = (canvasWidth - width) / 2 + point.x * width - point.screenX;
      element.scrollTop = (canvasHeight - height) / 2 + point.y * height - point.screenY;
    }
    focal.current = null;
  }, [width, height, canvasWidth, canvasHeight, fitting]);
  useLayoutEffect(() => {
    const element = stage.current;
    if (!element) return;
    const wheel = (event: WheelEvent) => { event.preventDefault(); zoom(actual * (event.deltaY < 0 ? 1.25 : .8), event.clientX, event.clientY); };
    element.addEventListener("wheel", wheel, { passive: false });
    return () => element.removeEventListener("wheel", wheel);
  });
  const canDrag = canvasWidth > viewport.width || canvasHeight > viewport.height;
  return <div className="image-lightbox" role="dialog" aria-modal="true" aria-label={alt || "图片预览"}>
    <div className="image-lightbox-toolbar">
      <button title="缩小" onClick={() => zoom(actual / 1.25)}><ZoomOut /></button>
      <output title="相对于原始图片尺寸">{Math.round(actual * 100)}%</output>
      <button title="放大" onClick={() => zoom(actual * 1.25)}><ZoomIn /></button>
      <button title="适应窗口" onClick={() => { focal.current = null; setFitting(true); }}><Scan /></button>
      <button title="关闭图片预览" onClick={onClose}><X /></button>
    </div>
    <div ref={stage} className={`image-lightbox-stage ${canDrag ? "can-drag" : ""}`} onDoubleClick={(event) => zoom(actual < 1 ? 1 : actual * 2, event.clientX, event.clientY)} onPointerDown={(event) => {
      if (!canDrag || event.button !== 0) return;
      event.preventDefault();
      drag.current = { x: event.clientX, y: event.clientY, left: event.currentTarget.scrollLeft, top: event.currentTarget.scrollTop };
      event.currentTarget.setPointerCapture(event.pointerId);
    }} onPointerMove={(event) => {
      if (!drag.current) return;
      event.currentTarget.scrollLeft = drag.current.left - (event.clientX - drag.current.x);
      event.currentTarget.scrollTop = drag.current.top - (event.clientY - drag.current.y);
    }} onPointerUp={(event) => { drag.current = null; if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); }} onPointerCancel={() => { drag.current = null; }} onLostPointerCapture={() => { drag.current = null; }}>
      <span className="image-lightbox-canvas" style={{ width: canvasWidth, height: canvasHeight }}>
        <img ref={image} src={src} alt={alt} draggable={false} style={{ width: natural.width ? width : undefined, height: natural.height ? height : undefined }} onLoad={(event) => setNatural({ width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight })} />
      </span>
    </div>
  </div>;
}
