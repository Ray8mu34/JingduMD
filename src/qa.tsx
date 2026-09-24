import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import MarkdownReader from "./components/MarkdownReader";
import SettingsPanel from "./components/SettingsPanel";
import { DEFAULT_PREFERENCES, type DocumentPayload, type TypographyProfileId, type AppearanceId } from "./types";
import { applyPreset, resolveReadingStyle } from "./lib/readerPreferences";
import "katex/dist/katex.min.css";
import "./styles.css";

const params = new URLSearchParams(location.search);
const sample = params.get("sample") || "reader-showcase.md";
const profile = (params.get("profile") === "study" ? "study" : "reading") as TypographyProfileId;
const appearance = (["warm", "white", "night", "nord"].includes(params.get("appearance") ?? "") ? params.get("appearance") : "warm") as AppearanceId;
const legacyTheme = params.get("legacyTheme");
const initialPreferences = legacyTheme ? applyPreset(DEFAULT_PREFERENCES, legacyTheme as typeof DEFAULT_PREFERENCES.theme) : { ...DEFAULT_PREFERENCES, typographyProfile: profile, appearance };

function QA() {
  const [doc, setDoc] = useState<DocumentPayload | null>(null);
  const [preferences, setPreferences] = useState(initialPreferences);
  const effective = resolveReadingStyle(preferences);
  useEffect(() => {
    void fetch(`/fixtures/${encodeURIComponent(sample)}`).then((response) => response.text()).then((content) => setDoc({ path: `C:\\fixtures\\${sample}`, name: sample, content, size: content.length, modifiedMs: 0 }));
  }, []);
  const style = {
    "--reader-size": `${effective.fontSize}px`, "--reader-leading": effective.lineHeight,
    "--reader-width": `${effective.contentWidth}px`, "--paragraph-space": `${effective.paragraphSpacing}em`,
    "--reader-font": legacyTheme
      ? effective.fontFamily === "serif" ? '"Source Han Serif SC", "Noto Serif CJK SC", "Songti SC", SimSun, serif' : '"Microsoft YaHei UI", "PingFang SC", "Noto Sans CJK SC", system-ui, sans-serif'
      : effective.fontFamily === "serif" ? 'Georgia, "Noto Serif SC", "Source Han Serif SC", "Noto Serif CJK SC", "Songti SC", SimSun, serif' : '"Noto Sans SC", "Microsoft YaHei UI", "PingFang SC", "Noto Sans CJK SC", system-ui, sans-serif',
    "--heading-font": legacyTheme
      ? effective.fontFamily === "serif" ? 'Georgia, "Noto Serif CJK SC", "Songti SC", serif' : 'Inter, "Microsoft YaHei UI", "PingFang SC", system-ui, sans-serif'
      : effective.fontFamily === "serif" ? 'Georgia, "Noto Serif SC", "Noto Serif CJK SC", "Songti SC", serif' : 'Inter, "Noto Sans SC", "Microsoft YaHei UI", "PingFang SC", system-ui, sans-serif',
    "--heading-scale": effective.headingScale, "--heading-space": effective.headingDensity === "compact" ? .78 : 1,
    "--code-scale": `${effective.codeScale}em`, "--formula-scale": `${effective.formulaScale}em`,
    "--reader-align": effective.textAlign, "--image-brightness": `${effective.imageBrightness}%`
  } as React.CSSProperties;
  return <div className={`app theme-${effective.theme} ${preferences.styleMode === "legacy" ? "style-legacy" : `appearance-${preferences.appearance} style-canonical profile-${preferences.typographyProfile}`} font-${effective.fontFamily}`}><div className="qa-toolbar">阅读样张 · {legacyTheme || `${profile} · ${appearance}`} · {sample}</div><main className="reader-scroll" style={style}>{doc && <MarkdownReader document={doc} night={effective.theme === "night" || effective.theme === "nord"} onOpenDocument={() => undefined} />}</main>{params.get("panel") === "settings" && <SettingsPanel value={preferences} root="" sampleStyle={style} onChange={setPreferences} onClose={() => undefined} />}</div>;
}

createRoot(document.getElementById("root")!).render(<QA />);
