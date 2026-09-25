import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import {
  Ban, BookOpenText, Check, Database, Eye, Palette, RefreshCw, RotateCcw,
  Save, Star, Type, X
} from "lucide-react";
import { filterSystemFonts, nextRecentFonts } from "../lib/fonts";
import SimpleReadingSettings from "./SimpleReadingSettings";
import {
  applyPreset, isPresetModified, matchingCustomProfile, READER_PRESETS, recipeFromPreferences
} from "../lib/readerPreferences";
import type {
  CustomReaderProfile, IndexDiagnostics, ReaderPreferences, ReaderThemeId,
  ReadingRecipe, SystemFont
} from "../types";

type Props = { value: ReaderPreferences; root: string; initialSection?: "reading" | "system"; sampleStyle?: CSSProperties; onChange: (value: ReaderPreferences) => void; onClose: (reason?: "button" | "tab") => void; onPreviewStart?: () => void; onPreviewEnd?: () => void };
type Tab = "presets" | "typography" | "content" | "system";

function formatBytes(value: number): string {
  if (!value) return "0 B";
  if (value < 1024 * 1024) return `${Math.max(1, Math.round(value / 1024))} KB`;
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}

export default function SettingsPanel(props: Props) {
  const [legacyEditor, setLegacyEditor] = useState(props.initialSection === "system");
  return legacyEditor ? <LegacySettingsPanel {...props} initialTab={props.initialSection === "system" ? "system" : "presets"} onClose={() => { if (props.initialSection === "system") props.onClose(); else setLegacyEditor(false); }} />
    : <SimpleReadingSettings value={props.value} sampleStyle={props.sampleStyle} onChange={props.onChange} onClose={props.onClose} onLegacyEdit={() => setLegacyEditor(true)} />;
}

function LegacySettingsPanel({ value, root, onChange, onClose, initialTab = "presets" }: Props & { initialTab?: Tab }) {
  const [tab, setTab] = useState<Tab>(initialTab);
  const [fonts, setFonts] = useState<SystemFont[]>([]);
  const [fontError, setFontError] = useState("");
  const [showAllFonts, setShowAllFonts] = useState(false);
  const [diagnostics, setDiagnostics] = useState<IndexDiagnostics | null>(null);
  const [indexAction, setIndexAction] = useState<"" | "rebuild" | "cancel">("");
  const cjkFonts = useMemo(() => filterSystemFonts(fonts, "cjk", showAllFonts), [fonts, showAllFonts]);
  const latinFonts = useMemo(() => filterSystemFonts(fonts, "latin", showAllFonts), [fonts, showAllFonts]);
  const activeCustom = matchingCustomProfile(value);
  const modified = isPresetModified(value) && !activeCustom;
  const set = <K extends keyof ReaderPreferences>(key: K, next: ReaderPreferences[K]) => onChange({ ...value, [key]: next });
  const setRecipe = <K extends keyof ReadingRecipe>(key: K, next: ReadingRecipe[K]) => onChange({
    ...value,
    [key]: next,
    ...(key === "readingFocus" ? { readingRuler: next !== "off" } : {})
  });

  useEffect(() => {
    if (!isTauri() || tab !== "typography") return;
    invoke<SystemFont[]>("list_system_fonts")
      .then((items) => setFonts(items.sort((left, right) => left.family.localeCompare(right.family, "zh-CN"))))
      .catch((error) => setFontError(String(error)));
  }, [tab]);

  const refreshDiagnostics = () => isTauri() && invoke<IndexDiagnostics>("get_index_diagnostics").then(setDiagnostics).catch(() => undefined);
  useEffect(() => { void refreshDiagnostics(); }, [root]);

  async function clearHighlights() {
    if (!root || !confirm("确定清除当前资料目录的全部高亮吗？此操作不会修改 Markdown 文件，但无法撤销。")) return;
    const removed = await invoke<number>("clear_root_highlights");
    await refreshDiagnostics();
    alert(`已清除 ${removed} 条高亮记录。`);
  }

  function updateFont(key: "chineseFont" | "latinFont" | "headingFont" | "codeFont", family: string, commit = false) {
    onChange({
      ...value,
      [key]: family,
      recentFonts: commit ? nextRecentFonts(value.recentFonts, family) : value.recentFonts
    });
  }

  function toggleFavorite(family: string) {
    const normalized = family.trim();
    if (!normalized) return;
    const exists = value.favoriteFonts.some((item) => item.toLocaleLowerCase() === normalized.toLocaleLowerCase());
    set("favoriteFonts", exists
      ? value.favoriteFonts.filter((item) => item.toLocaleLowerCase() !== normalized.toLocaleLowerCase())
      : [...value.favoriteFonts, normalized]);
  }

  function fontShortcuts(kind: "cjk" | "latin", key: "chineseFont" | "latinFont") {
    const supports = (family: string) => {
      const found = fonts.find((font) => font.family.toLocaleLowerCase() === family.toLocaleLowerCase());
      return !found || showAllFonts || (kind === "cjk" ? found.supportsCjk : found.supportsLatin);
    };
    const favorites = value.favoriteFonts.filter(supports);
    const recent = value.recentFonts.filter((family) => supports(family) && !favorites.some((item) => item.toLocaleLowerCase() === family.toLocaleLowerCase()));
    if (!favorites.length && !recent.length) return null;
    return <div className="font-shortcuts">
      {favorites.map((family) => <button key={`favorite-${family}`} onClick={() => updateFont(key, family, true)} title="收藏字体"><Star className="filled" />{family}</button>)}
      {recent.slice(0, 5).map((family) => <button key={`recent-${family}`} onClick={() => updateFont(key, family, true)} title="最近使用">{family}</button>)}
    </div>;
  }

  function saveCustomProfile() {
    const profile: CustomReaderProfile = {
      id: globalThis.crypto?.randomUUID?.() ?? `profile-${Date.now()}`,
      name: `我的样式 ${value.customProfiles.length + 1}`,
      recipe: recipeFromPreferences(value)
    };
    onChange({ ...value, customProfiles: [...value.customProfiles, profile] });
  }

  function applyCustomProfile(profile: CustomReaderProfile) {
    onChange({ ...value, ...profile.recipe, readingRuler: profile.recipe.readingFocus !== "off" });
  }

  function updateCustomProfile(id: string, update: Partial<CustomReaderProfile>) {
    set("customProfiles", value.customProfiles.map((profile) => profile.id === id ? { ...profile, ...update } : profile));
  }

  async function rebuild() {
    if (!root) return;
    setIndexAction("rebuild");
    try { await invoke("rebuild_index", { root }); }
    finally { setIndexAction(""); void refreshDiagnostics(); }
  }

  async function cancelIndex() {
    setIndexAction("cancel");
    try { await invoke("cancel_index"); }
    finally { setIndexAction(""); void refreshDiagnostics(); }
  }

  const allFontNames = fonts.map((font) => font.family);

  return <aside className="settings-sheet" aria-label={initialTab === "system" ? "应用设置" : "原有样式编辑"}>
    <div className="settings-title"><div><h2>{initialTab === "system" ? "应用设置" : "原有样式编辑"}</h2></div><button onClick={() => onClose("button")} title={initialTab === "system" ? "关闭应用设置" : "返回阅读设置"}><X /></button></div>
    {initialTab !== "system" && <nav className="settings-tabs" aria-label="设置分类">
      <button className={tab === "presets" ? "active" : ""} onClick={() => setTab("presets")}><Palette />预设</button>
      <button className={tab === "typography" ? "active" : ""} onClick={() => setTab("typography")}><Type />排版</button>
      <button className={tab === "content" ? "active" : ""} onClick={() => setTab("content")}><Eye />内容</button>
    </nav>}

    {tab === "presets" && <div className="settings-page">
      <div className="settings-intro"><strong>阅读配方</strong><span>选择后立即预览；颜色、字体节奏和内容组件会一起变化。</span></div>
      <div className="preset-gallery">
        {READER_PRESETS.map((preset) => {
          const active = value.theme === preset.id && !activeCustom;
          return <button key={preset.id} className={`preset-card ${active ? "active" : ""}`} onClick={() => onChange(applyPreset(value, preset.id))}>
            <span className="preset-swatch" style={{ background: preset.swatches[0], color: preset.swatches[1], borderColor: preset.swatches[2] }}><i style={{ background: preset.swatches[2] }} />Aa</span>
            <span><strong>{preset.name}{active && <Check />}</strong><small>{preset.category} · {preset.description}</small></span>
          </button>;
        })}
      </div>
      <div className="preset-actions">
        <div><strong>{activeCustom?.name ?? READER_PRESETS.find((item) => item.id === value.theme)?.name}</strong><span>{activeCustom ? "个人样式" : modified ? "已在预设基础上微调" : "当前使用完整预设"}</span></div>
        <button onClick={() => onChange(applyPreset(value, value.theme))} disabled={!modified}>恢复此原有样式</button>
        <button onClick={saveCustomProfile}>保存个人样式</button>
      </div>
      {!!value.customProfiles.length && <section className="custom-profiles">
        <div className="section-heading"><strong>我的样式</strong><span>保存在 AppData</span></div>
        {value.customProfiles.map((profile) => <div className={`custom-profile ${activeCustom?.id === profile.id ? "active" : ""}`} key={profile.id}>
          <button onClick={() => applyCustomProfile(profile)}><BookOpenText />{profile.name}</button>
          <input aria-label="样式名称" value={profile.name} onChange={(event) => updateCustomProfile(profile.id, { name: event.target.value })} />
          <button title="删除个人样式" onClick={() => set("customProfiles", value.customProfiles.filter((item) => item.id !== profile.id))}><X /></button>
        </div>)}
      </section>}
    </div>}

    {tab === "typography" && <div className="settings-page">
      <section className="settings-group">
        <div className="section-heading"><strong>正文节奏</strong><span>实时预览</span></div>
        <label>正文字号 <output>{value.fontSize}px</output><input type="range" min="14" max="26" step="0.5" value={value.fontSize} onChange={(event) => setRecipe("fontSize", +event.target.value)} /></label>
        <label>行高 <output>{value.lineHeight.toFixed(2)}</output><input type="range" min="1.35" max="2.2" step="0.01" value={value.lineHeight} onChange={(event) => setRecipe("lineHeight", +event.target.value)} /></label>
        <label>正文栏宽 <output>约 {Math.round(value.contentWidth / value.fontSize)} 字 / 行</output><input type="range" min="560" max="1200" step="20" value={value.contentWidth} onChange={(event) => setRecipe("contentWidth", +event.target.value)} /></label>
        <label>字距 <output>{value.letterSpacing.toFixed(3)}em</output><input type="range" min="-0.02" max="0.08" step="0.002" value={value.letterSpacing} onChange={(event) => setRecipe("letterSpacing", +event.target.value)} /></label>
        <label>段落样式<div className="segmented"><button className={value.paragraphStyle === "spacing" ? "active" : ""} onClick={() => setRecipe("paragraphStyle", "spacing")}>段间留白</button><button className={value.paragraphStyle === "indent" ? "active" : ""} onClick={() => setRecipe("paragraphStyle", "indent")}>首行缩进</button></div></label>
        {value.paragraphStyle === "spacing" ? <label>段间距 <output>{value.paragraphSpacing.toFixed(2)}em</output><input type="range" min="0.2" max="1.8" step="0.05" value={value.paragraphSpacing} onChange={(event) => setRecipe("paragraphSpacing", +event.target.value)} /></label>
          : <label>首行缩进 <output>{value.firstLineIndent.toFixed(1)}em</output><input type="range" min="1" max="3" step="0.1" value={value.firstLineIndent} onChange={(event) => setRecipe("firstLineIndent", +event.target.value)} /></label>}
        <label>正文对齐<select value={value.textAlign} onChange={(event) => setRecipe("textAlign", event.target.value as ReadingRecipe["textAlign"])}><option value="left">左对齐（默认更稳定）</option><option value="justify">两端对齐（适合中文书页）</option></select></label>
      </section>

      <section className="settings-group">
        <div className="section-heading"><strong>标题层级</strong><span>{value.headingFont || "系统无衬线"}</span></div>
        <label>标题比例 <output>{Math.round(value.headingScale * 100)}%</output><input type="range" min="0.85" max="1.25" step="0.01" value={value.headingScale} onChange={(event) => setRecipe("headingScale", +event.target.value)} /></label>
        <label>标题留白<select value={value.headingDensity} onChange={(event) => setRecipe("headingDensity", event.target.value as ReadingRecipe["headingDensity"])}><option value="compact">紧凑</option><option value="balanced">均衡</option><option value="airy">舒展</option></select></label>
      </section>

      <section className="settings-group font-library">
        <div className="section-heading"><strong>系统字体库</strong><span>{fonts.length ? `${fonts.length} 个字体家族` : fontError || "正在检测字形…"}</span></div>
        <label className="switch-row compact"><input type="checkbox" checked={showAllFonts} onChange={(event) => setShowAllFonts(event.target.checked)} />显示未确认覆盖所需文字的字体</label>
        <label>正文字体风格<select value={value.fontFamily} onChange={(event) => setRecipe("fontFamily", event.target.value as ReadingRecipe["fontFamily"])}><option value="serif">衬线阅读</option><option value="sans">清晰无衬线</option></select></label>
        <FontPicker label="中文字体" count={`${cjkFonts.length} 个中文可用`} list="jingreader-cjk-fonts" value={value.chineseFont} favorite={value.favoriteFonts.includes(value.chineseFont)} onChange={(family, commit) => updateFont("chineseFont", family, commit)} onFavorite={() => toggleFavorite(value.chineseFont)} shortcuts={fontShortcuts("cjk", "chineseFont")} />
        <FontPicker label="西文字体" count={`${latinFonts.length} 个西文可用`} list="jingreader-latin-fonts" value={value.latinFont} favorite={value.favoriteFonts.includes(value.latinFont)} onChange={(family, commit) => updateFont("latinFont", family, commit)} onFavorite={() => toggleFavorite(value.latinFont)} shortcuts={fontShortcuts("latin", "latinFont")} />
        <FontPicker label="标题字体" list="jingreader-all-fonts" value={value.headingFont} onChange={(family, commit) => updateFont("headingFont", family, commit)} />
        <FontPicker label="代码字体" list="jingreader-all-fonts" value={value.codeFont} onChange={(family, commit) => updateFont("codeFont", family, commit)} />
        <datalist id="jingreader-cjk-fonts">{cjkFonts.map((font) => <option value={font.family} key={font.family} />)}</datalist>
        <datalist id="jingreader-latin-fonts">{latinFonts.map((font) => <option value={font.family} key={font.family} />)}</datalist>
        <datalist id="jingreader-all-fonts">{allFontNames.map((family) => <option value={family} key={family} />)}</datalist>
        <div className="mixed-font-preview"><span>组合预览</span><p>静下心来读一篇长文 · The quick brown fox · 0123456789</p><small>正文、标题与代码可以分别选用本机字体；缺字时自动回退。</small></div>
      </section>
    </div>}

    {tab === "content" && <div className="settings-page">
      <section className="settings-group">
        <div className="section-heading"><strong>视觉舒适</strong><span>只影响阅读区</span></div>
        <label>纸张暖度 <output>{value.backgroundWarmth}%</output><input type="range" min="0" max="18" step="1" value={value.backgroundWarmth} onChange={(event) => setRecipe("backgroundWarmth", +event.target.value)} /></label>
        <label>文字对比增强 <output>{value.textContrast}%</output><input type="range" min="0" max="22" step="1" value={value.textContrast} onChange={(event) => setRecipe("textContrast", +event.target.value)} /></label>
        <label>阅读聚焦<select value={value.readingFocus} onChange={(event) => setRecipe("readingFocus", event.target.value as ReadingRecipe["readingFocus"])}><option value="off">关闭</option><option value="ruler">悬停标尺</option><option value="paragraph">聚焦段落，淡化上下文</option></select></label>
      </section>

      <section className="settings-group">
        <div className="section-heading"><strong>内容组件</strong><span>Markdown 保持只读</span></div>
        <label>引用样式<select value={value.quoteStyle} onChange={(event) => setRecipe("quoteStyle", event.target.value as ReadingRecipe["quoteStyle"])}><option value="bar">边线</option><option value="card">柔和卡片</option><option value="editorial">出版物缩进</option></select></label>
        <label>表格样式<select value={value.tableStyle} onChange={(event) => setRecipe("tableStyle", event.target.value as ReadingRecipe["tableStyle"])}><option value="plain">清晰网格</option><option value="striped">隔行底色</option><option value="compact">紧凑数据</option></select></label>
        <label>图片样式<select value={value.imageStyle} onChange={(event) => setRecipe("imageStyle", event.target.value as ReadingRecipe["imageStyle"])}><option value="soft">柔和阴影</option><option value="plain">无装饰</option><option value="bordered">细边框</option></select></label>
        <label>图片亮度 <output>{value.imageBrightness}%</output><input type="range" min="45" max="100" step="1" value={value.imageBrightness} onChange={(event) => setRecipe("imageBrightness", +event.target.value)} /></label>
        <label>代码比例 <output>{Math.round(value.codeScale * 100)}%</output><input type="range" min="0.72" max="1.05" step="0.01" value={value.codeScale} onChange={(event) => setRecipe("codeScale", +event.target.value)} /></label>
        <label>公式比例 <output>{Math.round(value.formulaScale * 100)}%</output><input type="range" min="0.8" max="1.35" step="0.05" value={value.formulaScale} onChange={(event) => setRecipe("formulaScale", +event.target.value)} /></label>
        <label className="switch-row"><input type="checkbox" checked={value.codeWrap} onChange={(event) => setRecipe("codeWrap", event.target.checked)} />长代码自动换行</label>
        <label className="switch-row"><input type="checkbox" checked={value.showFrontmatter} onChange={(event) => setRecipe("showFrontmatter", event.target.checked)} />显示文档属性</label>
        <label className="switch-row"><input type="checkbox" checked={value.showReadingStats} onChange={(event) => setRecipe("showReadingStats", event.target.checked)} />显示字数、时间和修改日期</label>
        <label>PDF 外观<select value={value.pdfStyle} onChange={(event) => set("pdfStyle", event.target.value as ReaderPreferences["pdfStyle"])}><option value="paper">清晰白纸（适合打印）</option><option value="current">沿用当前阅读预设</option></select></label>
        <label className="switch-row"><input type="checkbox" checked={value.pdfIncludeHighlights} onChange={(event) => set("pdfIncludeHighlights", event.target.checked)} />PDF 中保留文本高亮</label>
        <small className="settings-note">沿用当前预设会保留纸色、字色、字体、字号、行距、代码块和内容组件风格；部分打印机或驱动需要在打印窗口开启“背景图形”才能保留整页底色。</small>
        <small className="settings-note">代码块和图片可在内容右上角独立折叠；图片支持点击或“放大”按钮查看，按 Esc 退出。夜读预设会降低正文图片亮度，放大时恢复原始亮度。</small>
      </section>
    </div>}

    {tab === "system" && <div className="settings-page">
      <section className="settings-group privacy-settings">
        <div className="section-heading"><strong>远程图片隐私</strong><span>{value.allowedRemoteHosts.length} 个已允许站点</span></div>
        <label>加载策略<select value={value.remoteImagePolicy} onChange={(event) => set("remoteImagePolicy", event.target.value as ReaderPreferences["remoteImagePolicy"])}><option value="ask">每个站点先询问</option><option value="block">始终阻止</option><option value="allow">自动加载</option></select></label>
        {!!value.allowedRemoteHosts.length && <div className="allowed-hosts">{value.allowedRemoteHosts.map((host) => <span key={host}>{host}<button title="撤销站点权限" onClick={() => set("allowedRemoteHosts", value.allowedRemoteHosts.filter((item) => item !== host))}><X /></button></span>)}</div>}
        <small>默认不会向图片站点发出请求；本地图片不受影响。</small>
      </section>
      <section className="settings-group index-settings">
        <div className="section-heading"><strong><Database />全文索引</strong><span>Schema v{diagnostics?.schemaVersion ?? "—"}</span></div>
        <div className="index-diagnostics">
          <span>已索引文档<strong>{diagnostics?.indexedDocuments ?? "—"}</strong></span>
          <span>数据库大小<strong>{diagnostics ? formatBytes(diagnostics.databaseBytes) : "—"}</strong></span>
          <span>高亮摘录<strong>{diagnostics?.highlightCount ?? "—"}</strong></span>
          <span>资料正文副本<strong className={diagnostics?.storesRawContent ? "diagnostic-bad" : "diagnostic-good"}>{diagnostics?.storesRawContent ? "存在" : "不保存"}</strong></span>
        </div>
        <div className="index-actions">
          <button disabled={!root || indexAction !== ""} onClick={() => void rebuild()}><RefreshCw className={indexAction === "rebuild" ? "spin" : ""} />重建当前索引</button>
          <button disabled={!diagnostics?.status.running || indexAction !== ""} onClick={() => void cancelIndex()}><Ban />取消索引</button>
          <button disabled={!root || !diagnostics?.highlightCount} onClick={() => void clearHighlights()}><X />清除当前目录高亮</button>
        </div>
        <small>预设、个人样式、索引、阅读状态和高亮只保存在应用 AppData，资料目录保持零写入。高亮会保存选中文字及前后少量上下文，用于外部修改后的重新定位，但不保存完整 Markdown 副本。</small>
      </section>
    </div>}
  </aside>;
}

function FontPicker({ label, count, list, value, favorite, onChange, onFavorite, shortcuts }: {
  label: string;
  count?: string;
  list: string;
  value: string;
  favorite?: boolean;
  onChange: (family: string, commit: boolean) => void;
  onFavorite?: () => void;
  shortcuts?: React.ReactNode;
}) {
  return <label className="font-picker">{label}{count && <span className="coverage-count">{count}</span>}
    <div className="font-input-row">
      <input list={list} value={value} onChange={(event) => onChange(event.target.value, false)} onBlur={() => onChange(value, true)} placeholder="使用预设默认字体" />
      {onFavorite && <button className={favorite ? "selected" : ""} disabled={!value} title="收藏/取消收藏" onClick={onFavorite}><Star /></button>}
      <button title="恢复预设默认" onClick={() => onChange("", false)}><RotateCcw /></button>
    </div>
    {shortcuts}
  </label>;
}
