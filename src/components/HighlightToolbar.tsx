import { useRef } from "react";
import { Trash2, X } from "lucide-react";
import { HIGHLIGHT_COLORS, HIGHLIGHT_COLOR_LABELS } from "../lib/highlights";
import { useOutsideDismiss } from "../lib/useOutsideDismiss";
import type { HighlightColor } from "../types";

export default function HighlightToolbar({ x, y, color, onColor, onDelete, onClose }: {
  x: number; y: number; color?: HighlightColor;
  onColor: (color: HighlightColor) => void; onDelete?: () => void; onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useOutsideDismiss(true, [ref], onClose, true);
  return <div ref={ref} className="highlight-popover" style={{ left: x, top: y }} role="toolbar"
    aria-label={onDelete ? "编辑高亮" : "添加高亮"} onMouseDown={(event) => event.preventDefault()}>
    {HIGHLIGHT_COLORS.map((value) => <button key={value} className={`highlight-color color-${value} ${color === value ? "active" : ""}`}
      title={`${onDelete ? "改为" : "添加"}${HIGHLIGHT_COLOR_LABELS[value]}高亮`}
      aria-label={`${onDelete ? "改为" : "添加"}${HIGHLIGHT_COLOR_LABELS[value]}高亮`} aria-pressed={color === value} onClick={() => onColor(value)} />)}
    {onDelete && <button title="删除高亮" aria-label="删除高亮" onClick={onDelete}><Trash2 /></button>}
    <button title="关闭高亮工具栏" aria-label="关闭高亮工具栏" onClick={onClose}><X /></button>
  </div>;
}
