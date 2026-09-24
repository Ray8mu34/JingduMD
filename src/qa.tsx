import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import MarkdownReader from "./components/MarkdownReader";
import SettingsPanel from "./components/SettingsPanel";
import { DEFAULT_PREFERENCES, type DocumentPayload, type TypographyProfileId, type AppearanceId } from "./types";
import { applyPreset } from "./lib/readerPreferences";
import { readerPresentation } from "./lib/readerPresentation";
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
  const presentation = readerPresentation(preferences);
  useEffect(() => {
    void fetch(`/fixtures/${encodeURIComponent(sample)}`).then((response) => response.text()).then((content) => setDoc({ path: `C:\\fixtures\\${sample}`, name: sample, content, size: content.length, modifiedMs: 0 }));
  }, []);
  return <div className={`app ${presentation.classes}`}><style>{presentation.fontCss}</style><div className="qa-toolbar">阅读样张 · {legacyTheme || `${profile} · ${appearance}`} · {sample}</div><main className="reader-scroll" style={presentation.style}>{doc && <MarkdownReader document={doc} night={presentation.night} onOpenDocument={() => undefined} />}</main>{params.get("panel") === "settings" && <SettingsPanel value={preferences} root="" sampleStyle={presentation.style} onChange={setPreferences} onClose={() => undefined} />}</div>;
}

createRoot(document.getElementById("root")!).render(<QA />);
