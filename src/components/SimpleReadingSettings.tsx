import { useEffect, useRef, useState } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { X } from "lucide-react";
import katex from "katex";
import type { CSSProperties } from "react";
import type { AppearanceId, ReaderPreferences, SystemFont, TypographyProfileId } from "../types";
import { applyPreset, chooseAppearance, chooseTypographyProfile, READER_PRESETS, resolveReadingStyle, setTypographyOverride } from "../lib/readerPreferences";
import { trapTab } from "../lib/focus";

type Props = { value: ReaderPreferences; initialValue: ReaderPreferences; sampleStyle?: CSSProperties; onChange: (value: ReaderPreferences) => void; onClose: () => void; onLegacyEdit: () => void; onPreviewStart: () => void; onPreviewEnd: () => void };
const appearances: [AppearanceId, string][] = [["warm", "暖纸"], ["white", "素白"], ["night", "静谧夜读"], ["nord", "Nord 极夜"]];

export default function SimpleReadingSettings({ value, initialValue, sampleStyle, onChange, onClose, onLegacyEdit, onPreviewStart, onPreviewEnd }: Props) {
  const initial = useRef(initialValue);
  const [advanced, setAdvanced] = useState(false);
  const [fontOptions, setFontOptions] = useState(false);
  const [fonts, setFonts] = useState<SystemFont[]>([]);
  const [fontError, setFontError] = useState("");
  const [name, setName] = useState("");
  const panel = useRef<HTMLElement>(null);
  const effective = resolveReadingStyle(value);
  const gesture = { onPointerDown: onPreviewStart, onPointerUp: onPreviewEnd, onPointerCancel: onPreviewEnd, onKeyDown: onPreviewStart, onKeyUp: onPreviewEnd, onBlur: onPreviewEnd };
  useEffect(() => {
    panel.current?.querySelector<HTMLButtonElement>(".simple-choice button")?.focus();
  }, []);
  useEffect(() => {
    if (!fontOptions || !isTauri()) return;
    let active = true;
    void invoke<SystemFont[]>("list_system_fonts").then((items) => { if (active) setFonts(items); }).catch((error) => { if (active) setFontError(String(error)); });
    return () => { active = false; };
  }, [fontOptions]);
  const undo = () => onChange({ ...value,
    styleMode: initial.current.styleMode, typographyProfile: initial.current.typographyProfile,
    appearance: initial.current.appearance, typographyOverrides: initial.current.typographyOverrides,
    fontSize: initial.current.fontSize, theme: initial.current.theme,
    imageBrightness: initial.current.imageBrightness, backgroundWarmth: initial.current.backgroundWarmth,
    textContrast: initial.current.textContrast
  });
  const savePersonal = () => {
    const label = name.trim() || `个人排版 ${value.personalTypographies.length + 1}`;
    onChange({ ...value, personalTypographies: [...value.personalTypographies, {
      id: globalThis.crypto?.randomUUID?.() ?? String(Date.now()), name: label,
      profile: value.typographyProfile, overrides: {
        lineHeight: effective.lineHeight, contentWidth: effective.contentWidth, paragraphSpacing: effective.paragraphSpacing,
        fontFamily: effective.fontFamily, chineseFont: effective.chineseFont, latinFont: effective.latinFont,
        headingFont: effective.headingFont, codeFont: effective.codeFont, headingScale: effective.headingScale,
        headingDensity: effective.headingDensity, paragraphStyle: effective.paragraphStyle, firstLineIndent: effective.firstLineIndent,
        textAlign: effective.textAlign, letterSpacing: effective.letterSpacing, quoteStyle: effective.quoteStyle,
        tableStyle: effective.tableStyle, codeWrap: effective.codeWrap, codeScale: effective.codeScale,
        formulaScale: effective.formulaScale, imageStyle: effective.imageStyle
      }
    }] });
    setName("");
  };
  return <aside ref={panel} className="settings-sheet simple-settings" role="dialog" aria-modal="true" aria-label="阅读设置" onKeyDown={trapTab}>
    <div className="settings-title"><div><h2>阅读设置</h2><small>选择后立即应用并自动保存</small></div><button onClick={onClose} aria-label="关闭阅读设置"><X /></button></div>
    {value.styleMode === "legacy" && <div className="legacy-notice">当前保留原有样式：{READER_PRESETS.find((item) => item.id === value.theme)?.name ?? value.theme}。选择下方排版或外观后启用新版阅读样式。</div>}
    <div className="simple-settings-body">
      <section><h3>排版</h3><div className="simple-choice">{(["reading", "study"] as TypographyProfileId[]).map((profile) => <button key={profile} className={value.styleMode === "canonical" && value.typographyProfile === profile ? "active" : ""} onClick={() => onChange(chooseTypographyProfile(value, profile))}><strong>{profile === "reading" ? "阅读" : "研读"}</strong><small>{profile === "reading" ? "舒展的长文节奏" : "紧凑的章节与推导"}</small></button>)}</div></section>
      <section><h3>外观</h3><div className="simple-choice appearance-choice">{appearances.map(([id, label]) => <button key={id} className={`appearance-chip ${id} ${value.styleMode === "canonical" && value.appearance === id ? "active" : ""}`} onClick={() => onChange(chooseAppearance(value, id))}>{label}</button>)}</div></section>
      <section><label>正文字号 <output>{value.fontSize}px</output><input type="range" min="14" max="26" step=".5" value={value.fontSize} {...gesture} onChange={(event) => onChange({ ...value, fontSize: Number(event.target.value) })} /></label></section>
      <div className="settings-sample" style={sampleStyle}><article className="markdown-body"><h3>章节与段落</h3><p>安静阅读 Chinese &amp; English，公式 <span className="math-inline" dangerouslySetInnerHTML={{ __html: katex.renderToString("E=mc^2", { throwOnError: false }) }} /> 自然进入句子。</p></article></div>
      <button className="text-action" onClick={undo}>撤销本次阅读样式调整</button>
      <details open={advanced} onToggle={(event) => setAdvanced(event.currentTarget.open)}><summary>更多排版</summary>
        <label>行高 <output>{effective.lineHeight.toFixed(2)}</output><input type="range" min="1.35" max="2.2" step=".01" value={effective.lineHeight} {...gesture} onChange={(event) => onChange(setTypographyOverride(value, "lineHeight", Number(event.target.value)))} /></label>
        <label>正文栏宽 <output>{effective.contentWidth}px</output><input type="range" min="560" max="1000" step="20" value={effective.contentWidth} {...gesture} onChange={(event) => onChange(setTypographyOverride(value, "contentWidth", Number(event.target.value)))} /></label>
        <label>正文风格<select value={effective.fontFamily} onChange={(event) => onChange(setTypographyOverride(value, "fontFamily", event.target.value as "serif" | "sans"))}><option value="serif">衬线</option><option value="sans">无衬线</option></select></label>
        <label>段落<select value={effective.paragraphStyle} onChange={(event) => onChange(setTypographyOverride(value, "paragraphStyle", event.target.value as "spacing" | "indent"))}><option value="spacing">段间留白</option><option value="indent">连续行文，首行缩进</option></select></label>
        <button className="text-action" onClick={() => onChange({ ...value, typographyOverrides: { ...value.typographyOverrides, [value.typographyProfile]: {} } })}>恢复当前排版默认值</button>
        <details open={fontOptions} onToggle={(event) => setFontOptions(event.currentTarget.open)}><summary>字体选项</summary>
          {fontError && <small>{fontError}</small>}
          <datalist id="reading-fonts">{fonts.map((font) => <option key={font.family} value={font.family} />)}</datalist>
          {(["chineseFont", "latinFont", "headingFont", "codeFont"] as const).map((key) => <label key={key}>{({ chineseFont: "中文正文", latinFont: "西文正文", headingFont: "标题", codeFont: "代码" })[key]}<input list="reading-fonts" value={effective[key]} placeholder="系统默认" onChange={(event) => onChange(setTypographyOverride(value, key, event.target.value))} /></label>)}
        </details>
        <div className="personal-type"><input aria-label="个人排版名称" value={name} onChange={(event) => setName(event.target.value)} placeholder="个人排版名称" /><button onClick={savePersonal}>保存当前排版</button></div>
        {value.personalTypographies.map((item) => <div className="personal-type" key={item.id}><button onClick={() => onChange({ ...value, styleMode: "canonical", typographyProfile: item.profile, typographyOverrides: { ...value.typographyOverrides, [item.profile]: item.overrides } })}>{item.name}</button><button onClick={() => onChange({ ...value, personalTypographies: value.personalTypographies.filter((entry) => entry.id !== item.id) })} aria-label={`删除${item.name}`}>删除</button></div>)}
      </details>
      <details><summary>原有样式</summary><p>升级前的十一种样式和个人样式仍可使用。旧个人样式未保存的历史中西文字体无法从旧数据恢复，继续沿用当前字体。</p>
        <div className="legacy-choices">{READER_PRESETS.map((preset) => <button key={preset.id} onClick={() => onChange(applyPreset(value, preset.id))}>{preset.name}</button>)}</div>
        {value.customProfiles.map((profile) => <button className="text-action" key={profile.id} onClick={() => onChange({ ...value, styleMode: "legacy", ...profile.recipe })}>{profile.name}</button>)}
        <button className="text-action" onClick={onLegacyEdit}>编辑原有样式</button>
      </details>
    </div>
  </aside>;
}
