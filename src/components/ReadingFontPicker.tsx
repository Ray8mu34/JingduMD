import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Check, ChevronDown } from "lucide-react";
import type { SystemFont } from "../types";
import { canonicalFontFamily, matchingFonts } from "../lib/fontCatalog";

type Props = {
  label: string;
  value: string;
  fonts: SystemFont[];
  loading: boolean;
  error: string;
  inheritedLabel?: string;
  defaultLabel?: string;
  onSelect: (family: string) => void;
  onRetry: () => void;
};

export default function ReadingFontPicker({ label, value, fonts, loading, error, inheritedLabel, defaultLabel = "跟随排版", onSelect, onRetry }: Props) {
  const id = useId().replaceAll(":", "");
  const root = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const selected = canonicalFontFamily(fonts, value);
  const matches = useMemo(() => matchingFonts(fonts, query), [fonts, query]);
  const options = useMemo(() => [{ family: "", displayName: defaultLabel }, ...matches], [matches, defaultLabel]);
  useEffect(() => { if (open) input.current?.focus(); }, [open]);
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
    document.addEventListener("pointerdown", outside, true);
    return () => document.removeEventListener("pointerdown", outside, true);
  }, [open]);
  const choose = (family: string) => { if (family !== selected) onSelect(family); setOpen(false); setQuery(""); requestAnimationFrame(() => trigger.current?.focus()); };
  const move = (delta: number) => {
    setActive((current) => {
      const next = Math.max(0, Math.min(options.length - 1, current + delta));
      requestAnimationFrame(() => root.current?.querySelector(`#${id}-option-${next}`)?.scrollIntoView({ block: "nearest" }));
      return next;
    });
  };
  return <div className="reading-font-picker" ref={root}>
    <span className="font-picker-label">{label}</span>
    <button ref={trigger} type="button" className="reading-font-trigger" aria-label={`${label}字体`} aria-expanded={open} aria-haspopup="listbox" onClick={() => { setOpen((current) => !current); setQuery(""); setActive(Math.max(0, fonts.findIndex((font) => font.family === selected) + 1)); }}><span>{selected ? `${selected}${inheritedLabel ? ` · ${inheritedLabel}` : ""}` : defaultLabel}</span><ChevronDown aria-hidden="true" /></button>
    {open && <div className="reading-font-popover">
      <input ref={input} type="search" role="combobox" aria-label={`搜索${label}字体`} aria-autocomplete="list" aria-controls={`${id}-list`} aria-expanded="true" aria-activedescendant={`${id}-option-${active}`} value={query} onChange={(event) => { setQuery(event.target.value); setActive(0); }} onKeyDown={(event) => {
        if (event.nativeEvent.isComposing || event.keyCode === 229) return;
        if (event.key === "ArrowDown") { event.preventDefault(); move(1); }
        if (event.key === "ArrowUp") { event.preventDefault(); move(-1); }
        if (event.key === "Home") { event.preventDefault(); setActive(0); }
        if (event.key === "End") { event.preventDefault(); setActive(options.length - 1); }
        if (event.key === "Enter") { event.preventDefault(); choose(options[active]?.family ?? ""); }
        if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); setOpen(false); requestAnimationFrame(() => trigger.current?.focus()); }
      }} placeholder="搜索或浏览全部字体" />
      <div className="font-picker-count" aria-live="polite">{loading ? "正在读取字体…" : error ? "字体读取失败" : `${matches.length} / ${fonts.length} 种字体`}</div>
      {error && <button type="button" className="font-picker-retry" onClick={onRetry}>重试</button>}
      <div id={`${id}-list`} className="reading-font-list" role="listbox" aria-label={`${label}字体选项`}>
        {!loading && options.map((font, index) => <button key={font.family || "default"} type="button" id={`${id}-option-${index}`} role="option" aria-selected={selected === font.family} className={index === active ? "active" : ""} onMouseEnter={() => setActive(index)} onMouseDown={(event) => event.preventDefault()} onClick={() => choose(font.family)}>
          <span>{font.displayName || font.family || defaultLabel}{font.displayName && font.displayName !== font.family && <small>{font.family}</small>}</span>{selected === font.family && <Check aria-hidden="true" />}
        </button>)}
      </div>
    </div>}
  </div>;
}
