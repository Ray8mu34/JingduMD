import { useEffect, useState, type CSSProperties } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { useTabInvoke } from "../lib/tabContext";
import { Ban, Database, RefreshCw, X } from "lucide-react";
import SimpleReadingSettings from "./SimpleReadingSettings";
import type { IndexDiagnostics, ReaderPreferences } from "../types";

type Props = { value: ReaderPreferences; root: string; initialSection?: "reading" | "system"; sampleStyle?: CSSProperties; onChange: (value: ReaderPreferences) => void; onClose: (reason?: "button" | "tab") => void; onPreviewStart?: () => void; onPreviewEnd?: () => void };
function formatBytes(value: number): string {
  if (!value) return "0 B";
  if (value < 1024 * 1024) return `${Math.max(1, Math.round(value / 1024))} KB`;
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}

export default function SettingsPanel(props: Props) {
  return props.initialSection === "system" ? <ApplicationSettings {...props} />
    : <SimpleReadingSettings value={props.value} sampleStyle={props.sampleStyle} onChange={props.onChange} onClose={props.onClose} />;
}

function ApplicationSettings({ value, root, onChange, onClose }: Props) {
  const invoke = useTabInvoke();
  const [diagnostics, setDiagnostics] = useState<IndexDiagnostics | null>(null);
  const [indexAction, setIndexAction] = useState<"" | "rebuild" | "cancel">("");
  const set = <K extends keyof ReaderPreferences>(key: K, next: ReaderPreferences[K]) => onChange({ ...value, [key]: next });
  const refreshDiagnostics = () => isTauri() && invoke<IndexDiagnostics>("get_index_diagnostics").then(setDiagnostics).catch(() => undefined);
  useEffect(() => { void refreshDiagnostics(); }, [root]);
  async function clearHighlights() {
    if (!root || !confirm("将当前资料目录的全部高亮移入回收站？可在“更多 → 标注管理与备份”中恢复。")) return;
    const removed = await invoke<number>("clear_root_highlights");
    await refreshDiagnostics();
    alert(`已将 ${removed} 条高亮移入回收站。`);
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

  return <aside className="settings-sheet" aria-label="应用设置">
    <div className="settings-title"><h2>应用设置</h2><button onClick={() => onClose("button")} title="关闭应用设置"><X /></button></div>
    <div className="settings-page">
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
    </div>
  </aside>;
}
