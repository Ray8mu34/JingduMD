import { useEffect, useRef, useState } from "react";
import { ArrowLeft, Check, Minus, Plus, X } from "lucide-react";
import type { AppearanceId, ReaderPreferences, SystemFont, TypographyProfileId, TypographyOverride } from "../types";
import { applyPreset, chooseAppearance, chooseTypographyProfile, READER_PRESETS, resolveReadingStyle, setTypographyOverride } from "../lib/readerPreferences";
import { loadFontCatalog } from "../lib/fontCatalog";
import ReadingFontPicker from "./ReadingFontPicker";

type Props = { value: ReaderPreferences; onChange: (value: ReaderPreferences) => void; onClose: (reason?: "button" | "tab") => void; onLegacyEdit: () => void };
type Page = "quick" | "paragraph" | "fonts" | "personal" | "legacy";
const appearances: [AppearanceId, string][] = [["warm", "暖纸"], ["white", "素白"], ["night", "静谧夜读"], ["nord", "Nord 极夜"]];
const styleKeys = ["styleMode", "typographyProfile", "appearance", "legacyAppearance", "fontSize", "lineHeight", "contentWidth", "paragraphSpacing", "fontFamily", "chineseFont", "latinFont", "headingFont", "codeFont", "headingScale", "headingDensity", "paragraphStyle", "firstLineIndent", "textAlign", "letterSpacing", "quoteStyle", "tableStyle", "codeWrap", "codeScale", "formulaScale", "imageBrightness", "imageStyle", "backgroundWarmth", "textContrast", "theme", "readingFocus", "readingRuler"] as const;
const widths = [640, 760, 860];

export default function SimpleReadingSettings({ value, onChange, onClose, onLegacyEdit }: Props) {
  const baseline = useRef(new Map<string, unknown>());
  const applied = useRef(new Map<string, unknown>());
  const touched = useRef(new Set<string>());
  const [page, setPage] = useState<Page>("quick");
  const [fonts, setFonts] = useState<SystemFont[]>([]);
  const [fontError, setFontError] = useState("");
  const [fontsLoading, setFontsLoading] = useState(false);
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const [sizeDraft, setSizeDraft] = useState(String(value.fontSize));
  const panel = useRef<HTMLElement>(null);
  const effective = resolveReadingStyle(value);
  useEffect(() => { panel.current?.querySelector<HTMLElement>("[data-initial-focus]")?.focus(); }, [page]);
  useEffect(() => { setSizeDraft(String(value.fontSize)); }, [value.fontSize]);
  useEffect(() => {
    if (page !== "fonts") return;
    let active = true;
    setFontsLoading(true);
    void loadFontCatalog().then((items) => { if (active) { setFonts(items); setFontError(""); } }).catch((error) => { if (active) setFontError(String(error)); }).finally(() => { if (active) setFontsLoading(false); });
    return () => { active = false; };
  }, [page]);
  const refreshFonts = () => {
    setFontsLoading(true); setFontError("");
    void loadFontCatalog(true).then((items) => setFonts(items)).catch((error) => setFontError(String(error))).finally(() => setFontsLoading(false));
  };
  const change = (next: ReaderPreferences) => {
    for (const key of styleKeys) if (value[key] !== next[key]) {
      if (!touched.current.has(key) || value[key] !== applied.current.get(key)) baseline.current.set(key, value[key]);
      touched.current.add(key);
      applied.current.set(key, next[key]);
    }
    for (const profile of ["reading", "study"] as const) {
      const key = `override:${profile}`;
      if (value.typographyOverrides[profile] !== next.typographyOverrides[profile]) {
        if (!touched.current.has(key) || value.typographyOverrides[profile] !== applied.current.get(key)) baseline.current.set(key, value.typographyOverrides[profile]);
        touched.current.add(key);
        applied.current.set(key, next.typographyOverrides[profile]);
      }
    }
    onChange(next);
  };
  const setMeasure = (key: "lineHeight" | "contentWidth", next: number) => change(value.styleMode === "legacy" ? { ...value, [key]: next } : setTypographyOverride(value, key, next));
  const setDetail = <K extends keyof TypographyOverride>(key: K, next: TypographyOverride[K]) => change(value.styleMode === "legacy" ? { ...value, [key]: next } : setTypographyOverride(value, key, next));
  const undo = () => {
    const next = { ...value };
    for (const key of styleKeys) {
      if (touched.current.has(key) && Object.is(value[key], applied.current.get(key))) (next as unknown as Record<string, unknown>)[key] = baseline.current.get(key);
    }
    next.typographyOverrides = { ...value.typographyOverrides };
    for (const profile of ["reading", "study"] as const) {
      if (touched.current.has(`override:${profile}`) && value.typographyOverrides[profile] === applied.current.get(`override:${profile}`)) next.typographyOverrides[profile] = baseline.current.get(`override:${profile}`) as TypographyOverride;
    }
    touched.current.clear();
    baseline.current.clear();
    applied.current.clear();
    onChange(next);
  };
  const savePersonal = () => {
    const label = name.trim() || `个人排版 ${value.personalTypographies.length + 1}`;
    change({ ...value, personalTypographies: [...value.personalTypographies, { id: globalThis.crypto?.randomUUID?.() ?? String(Date.now()), name: label, profile: value.typographyProfile, overrides: {
      lineHeight: effective.lineHeight, contentWidth: effective.contentWidth, paragraphSpacing: effective.paragraphSpacing,
      fontFamily: effective.fontFamily, chineseFont: effective.chineseFont, latinFont: effective.latinFont,
      headingFont: effective.headingFont, codeFont: effective.codeFont, headingScale: effective.headingScale,
      headingDensity: effective.headingDensity, paragraphStyle: effective.paragraphStyle, firstLineIndent: effective.firstLineIndent,
      textAlign: effective.textAlign, letterSpacing: effective.letterSpacing, quoteStyle: effective.quoteStyle,
      tableStyle: effective.tableStyle, codeWrap: effective.codeWrap, codeScale: effective.codeScale,
      formulaScale: effective.formulaScale, imageStyle: effective.imageStyle
    } }] });
    setName(""); setSaving(false);
  };
  const defaultLeading = value.typographyProfile === "study" ? 1.78 : 1.85;
  const leadingOptions = [defaultLeading - .1, defaultLeading, defaultLeading + .1];
  const selectedAppearance = value.styleMode === "legacy" ? value.legacyAppearance : value.appearance;
  const title = ({ quick: "阅读设置", paragraph: "段落与细节", fonts: "字体", personal: "个人排版", legacy: "兼容样式" } as const)[page];
  return <aside ref={panel} className={`settings-sheet simple-settings page-${page}`} role="dialog" aria-label={title} onBlur={(event) => { if (event.relatedTarget && !event.currentTarget.contains(event.relatedTarget as Node)) onClose("tab"); }} onKeyDown={(event) => { if (event.key === "Escape" && page !== "quick") { event.preventDefault(); event.stopPropagation(); setPage("quick"); } }}>
    <div className="settings-title"><div className="settings-heading">{page !== "quick" && <button aria-label="返回阅读设置" onClick={() => setPage("quick")}><ArrowLeft /></button>}<h2>{title}</h2></div><button onClick={() => onClose("button")} aria-label="关闭阅读设置"><X /></button></div>
    <div className="simple-settings-body">
      {page === "quick" && <>
        {value.styleMode === "legacy" && <p className="quick-legacy-note">沿用“{READER_PRESETS.find((item) => item.id === value.theme)?.name ?? value.theme}”的排版。选择“阅读”或“研读”才切换排版。</p>}
        <section className="quick-row"><h3>字号</h3><div className="size-stepper"><button data-initial-focus aria-label="减小字号" onClick={() => change({ ...value, fontSize: Math.max(14, Math.round((value.fontSize - .5) * 2) / 2) })}><Minus /></button><input aria-label="正文字号" type="number" min="14" max="26" step="0.5" value={sizeDraft} onChange={(event) => setSizeDraft(event.target.value)} onBlur={() => { const number = Number(sizeDraft); if (Number.isFinite(number) && number >= 14 && number <= 26) change({ ...value, fontSize: number }); else setSizeDraft(String(value.fontSize)); }} onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); }} /><span>px</span><button aria-label="增大字号" onClick={() => change({ ...value, fontSize: Math.min(26, Math.round((value.fontSize + .5) * 2) / 2) })}><Plus /></button></div></section>
        <section className="quick-row"><h3 id="typography-label">排版</h3><div className="quick-options typography-options" role="radiogroup" aria-labelledby="typography-label">{(["reading", "study"] as TypographyProfileId[]).map((profile) => <label key={profile}><input type="radio" name="typography" checked={value.styleMode === "canonical" && value.typographyProfile === profile} onChange={() => change(chooseTypographyProfile(value, profile))} /><span>{profile === "reading" ? "阅读" : "研读"}</span></label>)}</div></section>
        <section className="quick-row"><h3 id="appearance-label">外观</h3><div className="quick-options appearance-options" role="radiogroup" aria-labelledby="appearance-label">{appearances.map(([id, label]) => <label key={id} title={label}><input type="radio" name="appearance" aria-label={label} checked={selectedAppearance === id} onChange={() => change(chooseAppearance(value, id))} /><span className={`appearance-dot ${id}`} aria-hidden="true" /><span>{id === "night" ? "夜读" : id === "nord" ? "极夜" : label}</span></label>)}</div></section>
        <section className="quick-row"><h3 id="leading-label">行距</h3><div className="quick-options measure-options" role="radiogroup" aria-labelledby="leading-label">{leadingOptions.map((number, index) => <label key={index}><input type="radio" name="leading" checked={Math.abs(effective.lineHeight - number) < .005} onChange={() => setMeasure("lineHeight", number)} /><span>{["紧凑", "标准", "舒展"][index]}</span></label>)}{!leadingOptions.some((number) => Math.abs(effective.lineHeight - number) < .005) && <span className="custom-value">自定 {effective.lineHeight.toFixed(2)}</span>}</div></section>
        <section className="quick-row"><h3 id="width-label">栏宽</h3><div className="quick-options measure-options" role="radiogroup" aria-labelledby="width-label">{widths.map((number, index) => <label key={number}><input type="radio" name="width" checked={effective.contentWidth === number} onChange={() => setMeasure("contentWidth", number)} /><span>{["窄", "标准", "宽"][index]}</span></label>)}{!widths.includes(effective.contentWidth) && <span className="custom-value">自定 {effective.contentWidth}px</span>}</div></section>
        <div className="quick-footer"><button onClick={() => setPage("paragraph")}>详细排版…</button>{touched.current.size > 0 && <button onClick={undo}>撤销</button>}</div>
      </>}
      {page === "paragraph" && <>
        <nav className="detail-tabs" aria-label="详细排版页面"><button className="active" data-initial-focus>段落</button><button onClick={() => setPage("fonts")}>字体</button></nav>
        <div className="detail-fields"><label>精确行距 <input type="number" min="1.35" max="2.2" step="0.01" value={effective.lineHeight} onChange={(event) => setMeasure("lineHeight", Number(event.target.value))} /></label><label>精确栏宽 <input type="number" min="560" max="1200" step="1" value={effective.contentWidth} onChange={(event) => setMeasure("contentWidth", Number(event.target.value))} /> px</label><label>段落方式<select value={effective.paragraphStyle} onChange={(event) => setDetail("paragraphStyle", event.target.value as "spacing" | "indent")}><option value="spacing">段间留白</option><option value="indent">首行缩进</option></select></label><label>段间距 <input type="number" min="0.2" max="1.8" step="0.05" value={effective.paragraphSpacing} onChange={(event) => setDetail("paragraphSpacing", Number(event.target.value))} /> em</label><label>首行缩进 <input type="number" min="1" max="3" step="0.1" value={effective.firstLineIndent} onChange={(event) => setDetail("firstLineIndent", Number(event.target.value))} /> em</label><label>正文对齐<select value={effective.textAlign} onChange={(event) => setDetail("textAlign", event.target.value as "left" | "justify")}><option value="left">左对齐</option><option value="justify">两端对齐</option></select></label><label>正文字体风格<select value={effective.fontFamily} onChange={(event) => setDetail("fontFamily", event.target.value as "serif" | "sans")}><option value="serif">衬线</option><option value="sans">无衬线</option></select></label></div>
        {value.styleMode === "canonical" && <button className="text-action" onClick={() => change({ ...value, typographyOverrides: { ...value.typographyOverrides, [value.typographyProfile]: {} } })}>恢复当前排版默认值</button>}
        <div className="detail-links"><button onClick={() => setPage("personal")}>个人排版</button><button onClick={() => setPage("legacy")}>兼容样式</button></div>
      </>}
      {page === "fonts" && <><nav className="detail-tabs" aria-label="详细排版页面"><button data-initial-focus onClick={() => setPage("paragraph")}>段落</button><button className="active">字体</button></nav><div className="font-catalog-actions"><span>{fontsLoading ? "正在读取字体…" : fontError || `本机 ${fonts.length} 种字体`}</span><button onClick={refreshFonts}>刷新列表</button></div><div className="font-role-fields">{(["chineseFont", "latinFont", "headingFont", "codeFont"] as const).map((key) => <ReadingFontPicker key={key} label={({ chineseFont: "中文正文", latinFont: "西文正文", headingFont: "标题", codeFont: "代码" })[key]} value={effective[key]} fonts={fonts} loading={fontsLoading} error={fontError} onRetry={refreshFonts} onSelect={(family) => setDetail(key, family)} />)}</div></>}
      {page === "personal" && <><p>保存当前排版，供以后快速选用。</p>{value.personalTypographies.map((item) => <div className="personal-type" key={item.id}><button data-initial-focus onClick={() => change({ ...value, styleMode: "canonical", typographyProfile: item.profile, typographyOverrides: { ...value.typographyOverrides, [item.profile]: item.overrides } })}>{item.name}</button><button onClick={() => change({ ...value, personalTypographies: value.personalTypographies.filter((entry) => entry.id !== item.id) })} aria-label={`删除${item.name}`}>删除</button></div>)}{saving ? <div className="personal-type"><input data-initial-focus aria-label="个人排版名称" value={name} onChange={(event) => setName(event.target.value)} placeholder="名称" /><button onClick={savePersonal}>保存</button><button onClick={() => setSaving(false)}>取消</button></div> : <button className="text-action" data-initial-focus onClick={() => setSaving(true)}>另存当前排版…</button>}</>}
      {page === "legacy" && <><p>继续使用升级前的十一种样式与个人样式。</p><div className="legacy-choices">{READER_PRESETS.map((preset) => <button key={preset.id} data-initial-focus={preset.id === value.theme ? true : undefined} onClick={() => change(applyPreset(value, preset.id))}>{preset.name}{value.styleMode === "legacy" && value.theme === preset.id && <Check />}</button>)}</div>{value.customProfiles.map((profile) => <button className="text-action" key={profile.id} onClick={() => change({ ...value, styleMode: "legacy", legacyAppearance: null, ...profile.recipe })}>{profile.name}</button>)}<button className="text-action" onClick={onLegacyEdit}>编辑原有样式…</button></>}
    </div>
  </aside>;
}
